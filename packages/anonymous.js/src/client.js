const crypto = require('crypto');
const BN = require('bn.js');

const utils = require('./utils/utils.js');
const { ElGamal } = require('./utils/algebra.js');
const Service = require('./utils/service.js');
const bn128 = require('./utils/bn128.js');

const sleep = (wait) => new Promise((resolve) => { setTimeout(resolve, wait); });

class Client {
    constructor(web3, zsc, home) {
        if (web3 === undefined)
            throw "Constructor's first argument should be an initialized Web3 object.";
        if (zsc === undefined)
            throw "Constructor's second argument should be a deployed ZSC contract object.";
        if (home === undefined)
            throw "Constructor's third argument should be the address of an unlocked Ethereum account.";

        web3.transactionConfirmationBlocks = 1;
        const that = this;

        const transfers = new Set();
        let epochLength = undefined;
        let fee = undefined;

        const getEpoch = (timestamp) => {
            return Math.floor((timestamp === undefined ? (new Date).getTime() / 1000 : timestamp) / epochLength);
        };

        const away = () => { // returns ms away from next epoch change
            const current = (new Date).getTime();
            return Math.ceil(current / (epochLength * 1000)) * (epochLength * 1000) - current;
        };

        const estimate = (size, contract) => {
            // size: 匿名集大小, contract: 布尔值, 合约是否需要交互 (为callback time留下缓冲)
            // size * log_2(size) * 20ms: 大约是对匿名集生成零知识证明 + 链上验证的时间
            // 5200ms: 固定开销项
            // 0 or 20ms: 是否需要callback ?
            // 由estimate返回的时间确保操作在一个epoch内完成, 若当前epoch剩余时间不足则把交易扔给下一个epoch

            // this expression is meant to be a relatively close upper bound of the time that proving + a few verifications will take, as a function of anonset size
            // this function should hopefully give you good epoch lengths also for 8, 16, 32, etc... if you have very heavy traffic, may need to bump it up (many verifications)
            // i calibrated this on _my machine_. if you are getting transfer failures, you might need to bump up the constants, recalibrate yourself, etc.
            return Math.ceil(size * Math.log(size) / Math.log(2) * 20 + 5200) + (contract ? 20 : 0);
            // the 20-millisecond buffer is designed to give the callback time to fire (see below).
        };

        // 接收方监听ZSC合约发起的TransferOccurred, {}表示不设置事件过滤条件
        zsc.events.TransferOccurred({}) // i guess this will just filter for "from here on out."
            // an interesting prospect is whether balance recovery could be eliminated by looking at past events.
            .on('data', (event) => {
                // console.log("Raw event data:", event);
                // console.log("Decoded parties:", event.returnValues['parties']);
                // console.log("Beneficiary point:", event.returnValues['beneficiary']);
                // console.log("Get in `zsc.events.TransferOccurred`"); // 不同的Transfer监听到TransferOccurred的次数不同, 还不知道监听到的次数和什么有关
                if (transfers.has(event.transactionHash)) { // transfer集合表示由当前客户端发起的交易, 因此在transfer集合的交易不处理? 可能是交给对方客户端处理
                    transfers.delete(event.transactionHash);
                    return;
                }
                const account = this.account;
                // 过滤有时Truffle莫名发起的空事件
                if (event.returnValues['parties'] === null) return; // truffle is sometimes emitting spurious (虚假的) empty events??? have to avoid this case manually.
                event.returnValues['parties'].forEach((party, i) => {
                    // parties内容 = 发送方, 接收方, 混淆地址的公钥们
                    if (account.keypair['y'].eq(bn128.deserialize(party))) { // bn128.deserialize: 把公钥地址反序列化为椭圆曲线点. 
                    // 可能keypair['x'], keypair['y']代表account的私钥和公钥点, Y = x \cdot G. ['x']是随机生成的BN大整数, ['y']是公钥在椭圆曲线上的点, 由(y.x, y.y)组成
                        const blockNumber = event.blockNumber;
                        web3.eth.getBlock(blockNumber).then((block) => {
                            account._state = account._simulate(block.timestamp);
                            web3.eth.getTransaction(event.transactionHash).then((transaction) => {
                                let inputs;
                                zsc._jsonInterface.forEach((element) => { // 获取.sol合约的JSON文件 (或者说ABI), 包含字段'name', 'type' (标识合约方法是function, event or constructor), 'inputs', 'outputs', 'stateMutability' (表示方法是否涉及资金转移, 如payable)
                                    if (element['name'] === "transfer")
                                        inputs = element['inputs']; // JSON文件中的'inputs'字段表示方法的参数列表, 所以这里是在TransferOccurred事件发生后获得`transfer`方法的参数列表
                                });
                                // 把`transfer`方法的参数列表inputs (二进制数据) 转换为可读的参数, slice(10)表明从第10个十六进制字符开始截, 跳过前10个字符(0x + 4字节函数选择器), 剩下的就是参数数据
                                const parameters = web3.eth.abi.decodeParameters(inputs, "0x" + transaction.input.slice(10)); 
                                // console.log("parameters['C'][i].x: ", parameters['C'][i].x);
                                // console.log("parameters['C'][i].y: ", parameters['C'][i].y);
                                // console.log("parameters['D'].x: ", parameters['D'].x);
                                // console.log("parameters['D'].y: ", parameters['D'].y);

                                // console.log("parameters: ", parameters);
                                // console.log("parameters.up_right: ", parameters['params']['up_right']);
                                // console.log("parameters.up_left: ", parameters['params']['up_left'][i]);


                                const value = utils.readBalance(parameters['C'][i], parameters['D'], account.keypair['x']);
                                // C[i] = y[i]*r + g*pl 当前帐户在混淆地址列表中的加密余额 (椭圆曲线点)
                                // D = g*r 加密过程中生成的随机点 (用于解密)
                                // x: 账户私钥 (大整数)
                                // 大概就是用知道当前帐户余额, 解密得到转账金额, 得到更新后的账户余额

                                const delta = utils.readBalance(parameters['params']['up_left'][i], parameters['params']['up_right'], account.keypair['x']);
                                if (value > 0) {
                                    account._state.pending += value;
                                    // 可以看到这一行在转账后的接收方的console中有输出, 这也映证了监听事件函数是作为"接收方"监听, 对于自己是"发送方"的交易通过transfers集合跳过监听.
                                    console.log("Transfer of " + value + " received! Balance now " + (account._state.available + account._state.pending) + ".");
                                }
                                
                                if (delta > 0) {
                                    console.log("Successfully received delta = " + delta + "!")
                                    console.log("sk before update in Red: ", account.keypair['x']);
                                    console.log("sk before update: ", account.keypair['x'].fromRed());
                                    console.log("pk before update: ", bn128.serialize(account.keypair['y']));
                                    account.keypair['x'] = account.keypair['x'].fromRed().add(new BN(delta)).toRed(bn128.q);
                                    account.keypair['y'] = bn128.curve.g.mul(delta).add(account.keypair['y']);
                                    console.log("sk after update: ", account.keypair['x']);
                                    console.log("pk after update: ", bn128.serialize(account.keypair['y']));
                                }
                            });
                        });
                    }
                });
                if (account.keypair['y'].eq(bn128.deserialize(event.returnValues['beneficiary']))) {
                    account._state.pending += fee;
                    console.log("Fee of " + fee + " received! Balance now " + (account._state.available + account._state.pending) + ".");
                }
            })
            .on('error', (error) => {
                console.log(error); // when will this be called / fired...?! confusing. also, test this.
            });

        this.account = new function() {
            this.keypair = undefined; // 在register函数中被生成, keypair['x']是一个随机大整数, keypair['y'] = bn128.curve.g.mul(x); 椭圆曲线上的一个点(y.x, y.y)
            this.name = undefined;
            this._state = {
                available: 0,
                pending: 0,
                nonceUsed: 0,
                lastRollOver: 0
            };

            // 根据timestamp对应的epoch更新, 返回一下最新情况
            this._simulate = (timestamp) => {
                const updated = {};
                updated.available = this._state.available;
                updated.pending = this._state.pending;
                updated.nonceUsed = this._state.nonceUsed; // 记录当前epoch是否转过账?
                updated.lastRollOver = getEpoch(timestamp);
                if (this._state.lastRollOver < updated.lastRollOver) {
                    updated.available += updated.pending;
                    updated.pending = 0;
                    updated.nonceUsed = false;
                }
                return updated;
            };

            this.balance = () => this._state.available + this._state.pending;
            this.public = () => bn128.serialize(this.keypair['y']);
            this.secret = () => "0x" + this.keypair['x'].toString(16, 64); // 将大整数keypair['x']转换为64长度的16进制字符串 (不够长度左侧补0)
        };

        this.friends = new function() {
            const friends = {};
            this.add = (name, pubkey) => {
                // todo: checks that these are properly formed, of the right types, etc...
                friends[name] = bn128.deserialize(pubkey); // 字典: name->椭圆曲线点
                console.log("Friend added.");
                return "Friend added.";
            };

            this.show = () => friends; // 返回这个字典
            this.remove = (name) => {
                if (!(name in friends)) {
                    console.log("Friend " + name + " not found in directory!");
                    throw "Friend " + name + " not found in directory!";
                }
                delete friends[name];
                console.log("Friend deleted.");
                return "Friend deleted.";
            };
        };

        this.register = (name, secret) => {
            return Promise.all([zsc.methods.epochLength().call(), zsc.methods.fee().call()]).then((result) => {
                epochLength = parseInt(result[0]); // 转换为整数
                fee = parseInt(result[1]);
                return new Promise((resolve, reject) => {
                    if (secret === undefined) { // 没有私钥->注册新用户
                        const keypair = utils.createAccount(); // 创建私钥x, 公钥y
                        const [c, s] = utils.sign(zsc._address, keypair); // 创建账户对ZSC合约地址的签名[challenge, response]
                        zsc.methods.register(bn128.serialize(keypair['y']), c, s).send({ 'from': home, 'gas': 6721975 }) // 将公钥和签名以一笔交易的形式发送给合约, 并监听返回结果 ('gas'参数是固定gas or 指定gas上限? 应该是后者)
                            .on('transactionHash', (hash) => { // 签名提交
                                console.log("Registration submitted (txHash = \"" + hash + "\").");
                            })
                            .on('receipt', (receipt) => { // 签名接收
                                that.account.keypair = keypair;
                                that.account.name = name;
                                console.log(name + " Registration successful.");
                                resolve();
                            })
                            .on('error', (error) => {
                                console.log("Registration failed: " + error);
                                reject(error);
                            });
                    } else { // 传入了私钥->恢复密钥对
                        const x = new BN(secret.slice(2), 16).toRed(bn128.q);
                        that.account.keypair = { 
                            'x': x, 
                            'y': bn128.curve.g.mul(x) 
                        };
                        zsc.methods.simulateAccounts([bn128.serialize(this.account.keypair['y'])], getEpoch() + 1) // 传入公钥和下一周期
                        .call().then((result) => {
                            const simulated = result[0];
                            that.account._state.available = utils.readBalance(simulated[0], simulated[1], x); // 恢复余额, simulated是什么得去读.sol代码, 但是感觉有点像自己给自己发了一笔(C, D, x)
                            that.account.name = name;
                            console.log("Account recovered successfully.");
                            resolve(); // warning: won't register you. assuming you registered when you first created the account.
                        });
                    }
                });
            });
        };

        this.deposit = (value) => {
            if (this.account.keypair === undefined)
                throw "Client's account is not yet registered!";
            const account = this.account;
            console.log("Initiating deposit.");
            return new Promise((resolve, reject) => {
                zsc.methods.fund(bn128.serialize(account.keypair['y']), value).send({ 'from': home, 'gas': 6721975 })
                    .on('transactionHash', (hash) => {
                        console.log("Deposit submitted (txHash = \"" + hash + "\").");
                    })
                    .on('receipt', (receipt) => {
                        account._state = account._simulate(); // have to freshly call it
                        account._state.pending += value;
                        console.log("Deposit of " + value + " was successful. Balance now " + (account._state.available + account._state.pending) + ".");
                        resolve(receipt);
                    })
                    .on('error', (error) => {
                        console.log("Deposit failed: " + error);
                        reject(error);
                    });
            });
        };

        this.transfer = (name, value, decoys, beneficiary) => { // todo: make sure the beneficiary is registered.
            if (this.account.keypair === undefined)
                throw "Client's account is not yet registered!";
            decoys = decoys ? decoys : []; // 混淆地址
            const account = this.account;
            const state = account._simulate();
            if (value + fee > state.available + state.pending)
                throw "Requested transfer amount of " + value + " (plus fee of " + fee + ") exceeds account balance of " + (state.available + state.pending) + ".";
            const wait = away(); // 距离下一个epoch的ms
            const seconds = Math.ceil(wait / 1000);
            const plural = seconds === 1 ? "" : "s";
            if (value > state.available) { // 前面已经检查过available + pending是够的, 但这里available不够, 说明account有一部分pending余额需要等下一个epoch释放
                console.log("Your transfer has been queued. Please wait " + seconds + " second" + plural + ", for the release of your funds...");
                return sleep(wait).then(() => this.transfer(name, value, decoys, beneficiary));
            }
            if (state.nonceUsed) { // nonce已用, 每个epoch只允许一次转账
                console.log("Your transfer has been queued. Please wait " + seconds + " second" + plural + ", until the next epoch...");
                return sleep(wait).then(() => this.transfer(name, value, decoys, beneficiary));
            }
            const size = 2 + decoys.length; // 发送方, 接收方 + 混淆地址 == 匿名集
            const estimated = estimate(size, false); // 根据size估计零知识证明 + 转账上链的时间
            if (estimated > epochLength * 1000) // epochLength有一种"一个epoch占多少秒"的感觉, 应该是在zsc.methods.epochLength()中定义的. 默认的应该是6s, 修改estimate中的固定时间使得estimated大于6000ms就会进入这条if
                // 如果估计时间甚至大于一个epoch时间, 那就需要修改epoch时间上限
                throw "The anonset size (" + size + ") you've requested might take longer than the epoch length (" + epochLength + " seconds) to prove. Consider re-deploying, with an epoch length at least " + Math.ceil(estimate(size, true) / 1000) + " seconds.";
            if (estimated > wait) {
                // 这里的3100是哪来的, 感觉像是epoch (6000ms) 的一半. 如果距离下一个epoch的时间不到3100ms, 甚至都不能把transfer加入队列, 得等下下个epoch
                console.log(wait < 3100 ? "Initiating transfer." : "Your transfer has been queued. Please wait " + seconds + " second" + plural + ", until the next epoch...");
                return sleep(wait).then(() => this.transfer(name, value, decoys, beneficiary));
            }
            if (size & (size - 1)) { // 匿名集size必须是2的幂, 为了零知识证明的效率
                let previous = 1;
                let next = 2;
                while (next < size) {
                    previous *= 2;
                    next *= 2;
                }
                throw "Anonset's size (including you and the recipient) must be a power of two. Add " + (next - size) + " or remove " + (size - previous) + ".";
            }

            // 我们选择在如下时间点更新不同地方储存的sk, pk
            // 1. 在zsc.methods.transfer上区块执行时, 更新Solidity中pending存的pk (更新字典的key, 可能就是删除pending[yHash]新建pending[new_yHash] = [new_y, balance])
            // 2. 在zsc.methods.transfer返回receipt后, 更新发送者的`friends`中的pk
            // 3. 在zsc.events.TransferOccurred({})监听到事件后, 监听者更新自己account的sk, pk
            const friends = this.friends.show(); // 得到的是一个字典, name->bn128.deserialize(pubkey)
            if (!(name in friends))
                throw "Name \"" + name + "\" hasn't been friended yet!";
            if (account.keypair['y'].eq(friends[name]))
                throw "Sending to yourself is currently unsupported (and useless!)."
            const y = [account.keypair['y'], friends[name]]; // not yet shuffled 现在就两个人
            decoys.forEach((decoy) => {
                if (!(decoy in friends))
                    throw "Decoy \"" + decoy + "\" is unknown in friends directory!";
                y.push(friends[decoy]); // 发送方地址, 接收方地址, 混淆地址组成的keypair['y'] (就是地址反序列化后得到的椭圆曲线坐标) 列表
            });
            if (beneficiary !== undefined && !(beneficiary in friends)) // ZSC合约手续费地址
                throw "Beneficiary \"" + beneficiary + "\" is not known!";
            const index = [];
            let m = y.length;
            while (m !== 0) { // https://bost.ocks.org/mike/shuffle/
                // Fisher-Yates 洗牌算法: 从后往前遍历, 每次把最后一个元素y[m]与y[0, m-1]之间一个随机元素交换, 然后m--
                // randomBytes(1).readUInt8(): 从[0, 255]生成一个随机数, 然后mod m, 因此当m不是256的约数时采样结果并不是均匀分布的
                // 比如m = 127, 255 % 127 = 1, 所以0和1会比[2, 127]多一个能采样到它的数字 (0--0, 127, 254; 1--1, 128, 255, 剩下的数字都只有2种可能), 这就是modulo bias
                const i = crypto.randomBytes(1).readUInt8() % m--; // warning: N should be <= 256. also modulo bias.
                // AI建议: 采用Rejection Sampling消除modulo bias

                // 交换y[i], y[m]
                const temp = y[i];
                y[i] = y[m];
                y[m] = temp;

                // 记录发送方, 接收方地址被交换后的位置
                if (account.keypair['y'].eq(temp)) index[0] = m;
                else if (friends[name].eq(temp)) index[1] = m;
            } // shuffle the array of y's
            if (index[0] % 2 === index[1] % 2) {
                // 要求发送方和接收方的索引奇偶性不同 (why?), 如果相同的话就把接收方和邻居换一下位置
                const temp = y[index[1]];
                y[index[1]] = y[index[1] + (index[1] % 2 === 0 ? 1 : -1)];
                y[index[1] + (index[1] % 2 === 0 ? 1 : -1)] = temp;
                index[1] = index[1] + (index[1] % 2 === 0 ? 1 : -1);
            } // make sure you and your friend have opposite parity
            return new Promise((resolve, reject) => {
                // y.map: 对y的每个元素 (椭圆曲线点[y.x, y.y]) 调用bn128.serialize得到公钥, simulateAccounts返回所有用户上一轮结束时的账户余额(oC[i], oD[i]) (序列化格式)
                zsc.methods.simulateAccounts(y.map(bn128.serialize), getEpoch()).call().then((result) => {
                    // const deserialized = result.map((account) => ElGamal.deserialize(account));
                    const deserialized = result.map(ElGamal.deserialize); // 序列化坐标反序列化为数值, 然后转换为ElGamal格式, (oC[i], oD[i]) 
                    // 其实ElGamal格式就只是把两个bn128.point放在一起而已, deserialized.map(bn128.serialize)就又回到result = (oC[i], oD[i]) 了
                    // console.log("result: ", result);
                    // console.log("deserialized: ", deserialized);
                    // deserialized.map(account => {
                    //     console.log(bn128.serialize(account.left()));
                    //     console.log(bn128.serialize(account.right()));
                    // })

                    if (deserialized.some((account) => account.zero())) // ElGamal.zero(), 公钥或私钥为bn128.zero
                        return reject(new Error("Please make sure all parties (including decoys) are registered.")); // todo: better error message, i.e., which friend?
                    
                    
                    const r = bn128.randomScalar(); // 随机数, 一种可能的作用是当adjustment相同时, 也有r*y[i]使得每个地址的C[i]很不同, 避免泄露转账金额信息
                    const D = bn128.curve.g.mul(r); // D = g*r
                    const C = y.map((party, i) => { // 所有用户的余额变化信息(C[i], D)
                        const adjustment = new BN(i === index[0] ? -value - fee : i === index[1] ? value : 0);
                        // console.log("adjustment: ", adjustment) // new BN(num)就可以将num映射到椭圆曲线群中, 使用toString就能还原数字
                        // console.log("adjustment.toRed(): ", adjustment.toRed().toString()); // Error
                        // console.log("adjustment.fromRed(): ", adjustment.fromRed().toString()) // Error

                        const left = ElGamal.base['g'].mul(adjustment).add(party.mul(r)); // C[i] = y[i]*r + g*pl
                        
                        // console.log("left.x: ", left.x.toString(16));
                        // console.log("left.y: ", left.y.toString(16));
                        // console.log("left.x.toRed(): ", left.x.toRed().toString(16)); // Error: Already a number in reduction context
                        // console.log("left.y.toRed(): ", left.y.toRed().toString(16));
                        // console.log("left.x.fromRed(): ", left.x.fromRed().toString(16));
                        // console.log("left.y.fromRed(): ", left.y.fromRed().toString(16));
                        
                        return new ElGamal(left, D);
                    });
                    // 所有用户更新后的加密余额Cn: ElGamal[] = C: ElGamal[] + deserialized: ElGamal[]
                    //  (nC[i], nD[i]) = (C[i], D) + (oC[i], oD[i])
                    //                 = (y[i]*r + g*pl, g*r) + (y[i]*x + g*b[i], g*x)
                    //                 = (y[i]*(r+x) + g*(pl+b[i]), g*(r+x))
                    const Cn = deserialized.map((account, i) => account.add(C[i])); 
                    
                    // console.log("C: ", C);
                    // console.log("D: ", D);
                    // console.log("Cn: ", Cn);

                    // FUL Zether新增变量 E: point[], up: ElGamal[], new_y: point[], 丢进ZKP和zsc.transfer. E要丢给Solidity后端更新该轮结束后的(nC[i], nD[i])
                    const new_r = bn128.randomScalar(); // 加密delta
                    const delta = crypto.randomBytes(1).readUInt8(); // 用于更新receiver密钥, 现在生成[0, 255]的随机数而不是[0, q]
                    // const delta = 88;
                    const up_r = bn128.curve.g.mul(new_r); // g*r'

                    const E = Cn.map(Cn_i => Cn_i.right().mul(delta));  // E = nD[i] * delta = g * (r+x) * delta
                    // console.log("E: ", E);

                    const up = y.map((party, i) => {
                        // 或许只有接收者要更新私钥, 混淆账户不用? 如果不用就像adjustment那样加个if
                        const up_l = ElGamal.base['g'].mul(delta).add(party.mul(new_r)); // up.l = y[i]*r' + g*delta
                        return new ElGamal(up_l, up_r);
                    });
                    // up: 记录转账中每个用户的(y[i]*r'+ g*delta, g*r')
                    // C:  记录转账中每个用户的(y[i]*r + g*pl, g*r)
                    
                    const new_y = y.map(party => ElGamal.base['g'].mul(delta).add(party)); // y[i]' = y[i] + g*delta
                    // console.log("y[0]: ", bn128.serialize(y[0])); // 忽然明白对于point优雅的打印方式就是bn128.serialize
                    // console.log("new_y[0]: ", bn128.serialize(new_y[0]));


                    const proof = Service.proveTransfer(Cn, C, y, state.lastRollOver, account.keypair['x'], r, value, state.available - value - fee, index, fee);
                    const u = utils.u(state.lastRollOver, account.keypair['x']); // 大概意思是生成 私钥 + epoch的加密标识: u = G_{epoch}*x
                    // 这样每个epoch每个私钥x都只能有一个u (nonce), 所以在过期的交易记录没法在新epoch通过, 避免重放攻击
                    const throwaway = web3.eth.accounts.create();  // 生成一个临时账户作为链上的msg.sender, 用它的私钥签名这笔交易, 它仅执行这一笔交易就被丢弃
                    // 这样做可以避免暴露主账户. 但有个问题: throwaway的余额是0, 那gas谁付呢? gas的支付方会暴露主账户吗?
                    // 学术研究上gas price = 0就这么做了, 现实中要实现的话也可以找个废弃地址 (甚至是就拿手续费地址), 打点钱, 让它一直签名. 不过如果一直用同一个地址是否会在encoded中暴露信息?
                    const beneficiaryKey = beneficiary === undefined ? bn128.zero : friends[beneficiary];

                    // C.map((ciphertext) => console.log("ciphertext.left(): ", ciphertext.left()));
                    // C.map((ciphertext) => console.log("ciphertext.left().x: ", ciphertext.left().x.toString(16)));
                    // C.map((ciphertext) => console.log("ciphertext.left().y: ", ciphertext.left().y.toString(16)));
                    // C.map((ciphertext) => console.log("ciphertext.left().getX(): ", ciphertext.left().getX().toString(16))); // getX()返回的是this.x.fromRed()
                    // C.map((ciphertext) => console.log("ciphertext.left().getY(): ", ciphertext.left().getY().toString(16)));
                    // C.map((ciphertext) => console.log("serilized ciphertext.left(): ", bn128.serialize(ciphertext.left())));

                    const encoded = zsc.methods.transfer(
                        // 把一堆东西序列化然后丢给zsc.methods.transfer
                        C.map((ciphertext) => bn128.serialize(ciphertext.left())), 
                        bn128.serialize(D), 
                        [ // TransferParams 结构体参数 (up_left, up_right, E)
                            up.map((uplefttext) => bn128.serialize(uplefttext.left())), // up_left 数组
                            bn128.serialize(up_r), // up_right
                            E.map(bn128.serialize) // E 数组
                        ],
                        y.map(bn128.serialize),
                        new_y.map(bn128.serialize), // new
                        bn128.serialize(u), 
                        proof.serialize(), 
                        bn128.serialize(beneficiaryKey)
                    ).encodeABI(); 
                    // ABI = Application Binary Interface, 外部客户端调用合约的接口. 调用了某个合约的ABI就相当于固定了这个合约接下来被打包到区块后要执行的内容
                    // 这里有一个很重要的内容, encodeABI() 只是生成调用合约方法的编码数据 (生成交易的有效负载`data`), 不会触发任何链上操作-----写好支票内容尚未签名
                    // 把编码数据写进tx, 直到web3.eth.sendSignedTransaction成功广播tx后 (接收到.on('receipt')事件) 才会执行被编码进tx中的zsc.methods.transfer方法
                    // web3.eth.sendSignedTransaction是原子操作, 一旦tx上链后zsc.methods.transfer emit TransferOccurred就会在同一区块完成, 
                    // 但是接收方监听到TransferOccurred后续处理花的时间可能超出resolve(receipt);返回的时间, 因为接收方监听器的处理不属于tx的内容
                    // 因此在调用完await alice.transfer()后还需要等100ms

                    // console.log(encoded);
                    // 签名并发送交易
                    const tx = { 'to': zsc._address, 'data': encoded, 'gas': 7721975, 'nonce': 0 };
                    web3.eth.accounts.signTransaction(tx, throwaway.privateKey).then((signed) => {
                        // console.log(signed);
                        web3.eth.sendSignedTransaction(signed.rawTransaction) // signed.rawTransaction就是throwaway签完名的交易, 用.on监听PromiEvent不同阶段的事件
                            .on('transactionHash', (hash) => {
                                // 1. 发送方广播交易, 但交易尚未被打包
                                transfers.add(hash);
                                console.log("Transfer submitted (txHash = \"" + hash + "\").");
                            })
                            .on('receipt', (receipt) => {
                                // 2. 交易已被某一区块打包, tx内编码的zsc.methods.transfer方法执行完成
                                account._state = account._simulate(); // have to freshly call it
                                account._state.nonceUsed = true;
                                account._state.pending -= value + fee;

                                // console.log(receipt);
                                console.log("Transfer of " + value + " (with fee of " + fee + ") was successful. Balance now " + (account._state.available + account._state.pending) + ".");

                                // 更新friends中存的公钥信息
                                console.log("friends pks before updated:");
                                console.log(bn128.serialize(friends[name]));
                                friends[name] = bn128.curve.g.mul(delta).add(friends[name]);
                                decoys.forEach((decoy) => {
                                    console.log(bn128.serialize(friends[decoy]));
                                    friends[decoy] = bn128.curve.g.mul(delta).add(friends[decoy]);
                                });

                                console.log("friends pks after updated:");
                                console.log(bn128.serialize(friends[name]));
                                decoys.forEach((decoy) => {
                                    console.log(bn128.serialize(friends[decoy]));
                                });


                                resolve(receipt);
                            })
                            .on('error', (error) => {
                                console.log("Transfer failed: " + error);
                                reject(error);
                            });
                    });
                });
            });
        };

        this.withdraw = (value) => {

            if (this.account.keypair === undefined)
                throw "Client's account is not yet registered!";
            const account = this.account;
            console.log("withdraw address: ", bn128.serialize(account.keypair['y']));
            const state = account._simulate();
            if (value > state.available + state.pending)
                throw "Requested withdrawal amount of " + value + " exceeds account balance of " + (state.available + state.pending) + ".";
            const wait = away();
            const seconds = Math.ceil(wait / 1000);
            const plural = seconds === 1 ? "" : "s";
            if (value > state.available) {
                console.log("Your withdrawal has been queued. Please wait " + seconds + " second" + plural + ", for the release of your funds...");
                return sleep(wait).then(() => this.withdraw(value));
            }
            if (state.nonceUsed) {
                console.log("Your withdrawal has been queued. Please wait " + seconds + " second" + plural + ", until the next epoch...");
                return sleep(wait).then(() => this.withdraw(value));
            }
            if (3100 > wait) { // determined empirically. IBFT (立即跨银行转账?), block time 1
                console.log("Initiating withdrawal.");
                return sleep(wait).then(() => this.withdraw(value));
            }
            return new Promise((resolve, reject) => {
                zsc.methods.simulateAccounts([bn128.serialize(account.keypair['y'])], getEpoch()).call()
                    .then((result) => {
                        // result = [CLn, CRn]
                        console.log("result: ", result);
                        const deserialized = ElGamal.deserialize(result[0]);
                        const C = deserialized.plus(new BN(-value)); // C = CLn - value
                        console.log("state.available - value: ", state.available - value);
                        const proof = Service.proveBurn(C, account.keypair['y'], state.lastRollOver, home, account.keypair['x'], state.available - value);
                        const u = utils.u(state.lastRollOver, account.keypair['x']);
                        zsc.methods.burn(bn128.serialize(account.keypair['y']), value, bn128.serialize(u), proof.serialize()).send({ 'from': home, 'gas': 6721975 })
                            .on('transactionHash', (hash) => {
                                console.log("Withdrawal submitted (txHash = \"" + hash + "\").");
                                // 至少运行到这了, 说明是没有收到receipt, zsc.methods.burn有问题
                            })
                            .on('receipt', (receipt) => {
                                account._state = account._simulate(); // have to freshly call it
                                account._state.nonceUsed = true;
                                account._state.pending -= value;
                                console.log("Withdrawal of " + value + " was successful. Balance now " + (account._state.available + account._state.pending) + ".");
                                resolve(receipt);
                            }).on('error', (error) => {
                                console.log("Withdrawal failed: " + error);
                                reject(error);
                            });
                    });
            });
        };
    }
}

module.exports = Client;