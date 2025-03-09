// SPDX-License-Identifier: Apache License 2.0
pragma solidity ^0.7.0;
pragma experimental ABIEncoderV2;

import "./CashToken.sol";
import "./Utils.sol";
import "./InnerProductVerifier.sol";
import "./ZetherVerifier.sol";
import "./BurnVerifier.sol";

contract ZSC {
    using Utils for uint256;
    using Utils for Utils.G1Point;

    CashToken coin;
    ZetherVerifier zetherVerifier;
    BurnVerifier burnVerifier;
    uint256 public epochLength;
    uint256 public fee;

    uint256 constant MAX = 4294967295; // 2^32 - 1 // no sload for constants...!
    mapping(bytes32 => Utils.G1Point[2]) acc; // main account mapping
    mapping(bytes32 => Utils.G1Point[2]) pending; // storage for pending transfers
    // mapping(bytes32 => Utils.G1Point) E; // 更新pk
    mapping(bytes32 => uint256) lastRollOver;
    bytes32[] nonceSet; // would be more natural to use a mapping, but they can't be deleted / reset!
    uint256 lastGlobalUpdate = 0; // will be also used as a proxy for "current epoch", seeing as rollovers will be anticipated
    // not implementing account locking for now...revisit

    struct TransferParams {
        Utils.G1Point[] up_left;
        Utils.G1Point up_right;
        Utils.G1Point[] E;
    }

    event TransferOccurred(Utils.G1Point[] parties, Utils.G1Point beneficiary);
    // arg is still necessary for transfers---not even so much to know when you received a transfer, as to know when you got rolled over.

    constructor(address _coin, address _zether, address _burn, uint256 _epochLength) { // visibiility won't be needed in 7.0
        // epoch length, like block.time, is in _seconds_. 4 is the minimum!!! (To allow a withdrawal to go through.)
        coin = CashToken(_coin); // CashToken.address
        zetherVerifier = ZetherVerifier(_zether); // ZetherVerifier.address
        burnVerifier = BurnVerifier(_burn); // BurnVerifier.address
        epochLength = _epochLength; // 6 seconds
        fee = zetherVerifier.fee();
        Utils.G1Point memory empty;
        pending[keccak256(abi.encode(empty))][1] = Utils.g(); // "register" the empty account...
    }

    function simulateAccounts(Utils.G1Point[] memory y, uint256 epoch) view public returns (Utils.G1Point[2][] memory accounts) {
        // in this function and others, i have to use public + memory (and hence, a superfluous copy from calldata)
        // only because calldata structs aren't yet supported by solidity. revisit this in the future.

        // 这个函数只是"模拟"了最新一轮结束时的[CLn, CRn] (把pending加上), 并没有"修改"acc的内容
        uint256 size = y.length;
        accounts = new Utils.G1Point[2][](size);
        for (uint256 i = 0; i < size; i++) {
            bytes32 yHash = keccak256(abi.encode(y[i])); // 用公钥y[i]获得钱包地址
            accounts[i] = acc[yHash]; // 用钱包地址读取[CLn, CRn]
            // 如果账户的上次更新epoch小于当前epoch, 则把pending中的余额加到[CLn, CRn]里去
            if (lastRollOver[yHash] < epoch) {
                Utils.G1Point[2] memory scratch = pending[yHash];
                accounts[i][0] = accounts[i][0].add(scratch[0]);
                accounts[i][1] = accounts[i][1].add(scratch[1]);
            }
        }
    }




    // 传入钱包地址, 更新acc = acc + pending
    function rollOver(bytes32 yHash) internal {
        uint256 e = block.timestamp / epochLength; // 当前epoch
        if (lastRollOver[yHash] < e) {
            Utils.G1Point[2][2] memory scratch = [acc[yHash], pending[yHash]]; // 临时存储acc, pending
            // scratch结构: 
            // [[acc[yHash][0], acc[yHash][1]], 对应主账户CLn, CRn
            // [pending[yHash][0], pending[yHash][1]]] 对应调整分量deltaC, deltaD
            // 忽然好奇Solidity支持x = x + y这种表达式吗, 是不是为了避免这种表达式引入scratch
            acc[yHash][0] = scratch[0][0].add(scratch[1][0]); // CLn' = CLn + deltaC
            acc[yHash][1] = scratch[0][1].add(scratch[1][1]); // CRn' = CRn + deltaD
            // acc[yHash] = scratch[0]; // can't do this---have to do the above instead (and spend 2 sloads / stores)---because "not supported". revisit
            delete pending[yHash]; // pending[yHash] = [Utils.G1Point(0, 0), Utils.G1Point(0, 0)]; pending[yHash]更新完毕, 清空
            lastRollOver[yHash] = e;
        }
        if (lastGlobalUpdate < e) {
            lastGlobalUpdate = e;
            delete nonceSet; // 如果当前epoch是最新epoch, 那清空uHash
        }
    }

    function registered(bytes32 yHash) internal view returns (bool) {
        Utils.G1Point memory zero = Utils.G1Point(0, 0);
        Utils.G1Point[2][2] memory scratch = [acc[yHash], pending[yHash]];
        return !(scratch[0][0].eq(zero) && scratch[0][1].eq(zero) && scratch[1][0].eq(zero) && scratch[1][1].eq(zero));
    }

    function register(Utils.G1Point memory y, uint256 c, uint256 s) public {
        // allows y to participate. c, s should be a Schnorr signature on "this"
        Utils.G1Point memory K = Utils.g().mul(s).add(y.mul(c.neg()));
        uint256 challenge = uint256(keccak256(abi.encode(address(this), y, K))).mod();
        require(challenge == c, "Invalid registration signature!");
        bytes32 yHash = keccak256(abi.encode(y));
        require(!registered(yHash), "Account already registered!");
        // pending[yHash] = [y, Utils.g()]; // "not supported" yet, have to do the below
        pending[yHash][0] = y;
        pending[yHash][1] = Utils.g();
    }

    function fund(Utils.G1Point memory y, uint256 bTransfer) public {
        bytes32 yHash = keccak256(abi.encode(y));
        require(registered(yHash), "Account not yet registered.");
        rollOver(yHash);

        require(bTransfer <= MAX, "Deposit amount out of range."); // uint, so other way not necessary?

        Utils.G1Point memory scratch = pending[yHash][0];
        scratch = scratch.add(Utils.g().mul(bTransfer));
        pending[yHash][0] = scratch;
        require(coin.transferFrom(msg.sender, address(this), bTransfer), "Transfer from sender failed.");
        require(coin.balanceOf(address(this)) <= MAX, "Fund pushes contract past maximum value.");
    }

    function transfer(
        Utils.G1Point[] memory C, 
        Utils.G1Point memory D, 
        TransferParams memory params,  // 合并 up_left, up_right, E
        Utils.G1Point[] memory y, 
        Utils.G1Point[] memory new_y, 
        Utils.G1Point memory u, 
        bytes memory proof, 
        Utils.G1Point memory beneficiary
    ) public {
        // C: 匿名集中每个账户的余额变化 (ElGamal密文左分量)
        // D: 公共随机点, D = r·G, 用来加密调整 (ElGamal密文右分量) ? 没懂D到底是干嘛的
        // y: 匿名集公钥
        // u: 绑定用户私钥和epoch的Nonce, u = G_epoch * x, 防止重放攻击
        // proof: 为了让交易通过而零知识证明 (金额守恒, 私钥有效性)
        // beneficiary: 手续费接收方公钥
        uint256 size = y.length;
        uint256 size_new_y = new_y.length;
        Utils.G1Point[] memory CLn = new Utils.G1Point[](size);
        Utils.G1Point[] memory CRn = new Utils.G1Point[](size);
        require(C.length == size, "Input array `C` length mismatch!");
        require(size == size_new_y, "y and y' length mismatch!");
        require(params.up_left.length == size, "Input array `up` length mismatch!");
        require(params.up_right.x != 0 && params.up_right.y != 0, "`up_right` is invalid!");
        require(params.E.length == size, "Input array `E` length mismatch!");

        // Stack too deep 所以先把手续费地址的更新注释掉了
        // bytes32 beneficiaryHash = keccak256(abi.encode(beneficiary)); // 手续费接收方钱包地址
        // require(registered(beneficiaryHash), "Miner's account is not yet registered."); // necessary so that receiving a fee can't "backdoor" you into registration.
        // rollOver(beneficiaryHash); // 把手续费地址在前一个epoch的pending余额合并的acc
        // pending[beneficiaryHash][0] = pending[beneficiaryHash][0].add(Utils.g().mul(fee));

        for (uint256 i = 0; i < size; i++) {
            bytes32 yHash = keccak256(abi.encode(y[i]));
            require(registered(yHash), "Account not yet registered.");
            rollOver(yHash);
            Utils.G1Point[2] memory scratch = pending[yHash];

            
            // acc[yHash], pending[yHash]结构: (pk*x + g*balance, g*x)
            // (c[i], D)结构: (pk*r + g*pl, g*r)
            // 相加得到: (pk*(x+r) + g*(balance+gl), g*(x+r))
            // new_pk = pk + g*delta, 把new_pk替换掉上式的pk得到new_pending
            // new_pending = ((pk+g*delta) * (x+r) + g*(balance+gl), g*r)
            //             = (pk*(x+r) + g*(balance+gl) + g*delta*(x+r), g*r)
            //             = (pending[0] + E, pending[1])
            // 这个pending不是模拟更新后的结果, 而是真的把这笔转账加到acc的pending上了. (但是这不应该在ZKP通过之后做吗?)
            pending[yHash][0] = scratch[0].add(C[i]);
            pending[yHash][1] = scratch[1].add(D);
            // pending[yHash] = scratch; // can't do this, so have to use 2 sstores _anyway_ (as in above)

            // new_pending[i] = (pending[i].left + E[i], pending[i].right)
            pending[new_yHash][0] = pending[yHash][0].add(params.E[i]);
            pending[new_yHash][1] = pending[yHash][1];
            // delete pending[yHash];

            // CLn[i]和CRn[i]是模拟更新后的加密余额, 用于零知识证明验证
            scratch = acc[yHash]; // trying to save an sload, i guess.
            CLn[i] = scratch[0].add(C[i]);
            CRn[i] = scratch[1].add(D);
        }

        // 防重放攻击 (同一交易被重复提交)
        bytes32 uHash = keccak256(abi.encode(u));
        for (uint256 i = 0; i < nonceSet.length; i++) {
            require(nonceSet[i] != uHash, "Nonce already seen!");
        }
        nonceSet.push(uHash);

        // 因为原来transfer + verifyTransfer的参数数量超过了EVM的栈深度限制16
        // 所以要构造结构体参数 statement, 感觉耗时多了好久
        ZetherVerifier.ZetherStatement memory statement;
        statement.CLn = CLn;
        statement.CRn = CRn;
        statement.C = C;
        statement.D = D;
        statement.y = y;
        statement.epoch = lastGlobalUpdate;
        statement.u = u;

        require(zetherVerifier.verifyTransfer(statement, proof), "Transfer proof verification failed!");

        emit TransferOccurred(y, beneficiary); // 发射一个事件
        // require(false, "DEBUG: TransferOccurred emitted"); // 强制回滚，观察日志
    }

    function burn(Utils.G1Point memory y, uint256 bTransfer, Utils.G1Point memory u, bytes memory proof) public {
        // bTransfer = 要烧毁的value
        bytes32 yHash = keccak256(abi.encode(y));
        // require(false, "Test here");
        require(registered(yHash), "Account not yet registered.");
        rollOver(yHash);

        require(0 <= bTransfer && bTransfer <= MAX, "Transfer amount out of range.");
        Utils.G1Point[2] memory scratch = pending[yHash];
        pending[yHash][0] = scratch[0].add(Utils.g().mul(bTransfer.neg()));

        scratch = acc[yHash]; // simulate debit of acc---just for use in verification, won't be applied
        scratch[0] = scratch[0].add(Utils.g().mul(bTransfer.neg())); // 模拟扣款后的acc用于验证证明, 实际上的扣款是先在pending扣, 在下一个epoch把pending的扣款加到acc上
        bytes32 uHash = keccak256(abi.encode(u));
        for (uint256 i = 0; i < nonceSet.length; i++) {
            require(nonceSet[i] != uHash, "Nonce already seen!");
        }
        nonceSet.push(uHash);

        require(burnVerifier.verifyBurn(scratch[0], scratch[1], y, lastGlobalUpdate, u, msg.sender, proof), "Burn proof verification failed!");
        require(coin.transfer(msg.sender, bTransfer), "This shouldn't fail... Something went severely wrong.");
    }
}
