const bn128 = require('./bn128.js')
const BN = require('bn.js')
const { soliditySha3 } = require('web3-utils');
const ABICoder = require('web3-eth-abi');

const utils = {};

utils.sign = (address, keypair) => {
    const k = bn128.randomScalar(); // 随机临时私钥
    const K = bn128.curve.g.mul(k); // 临时公钥K = k·G
    const c = utils.hash(ABICoder.encodeParameters([ // 得到哈希值challenge, 并且是红黑树编码下的. c = H(addr, Y, K) mod q
        'address',
        'bytes32[2]',
        'bytes32[2]',
    ], [
        address,
        bn128.serialize(keypair['y']),
        bn128.serialize(K),
    ]));

    const s = c.redMul(keypair['x']).redAdd(k); // response s = c·x + k. 红黑树格式下的运算提高效率
    return [bn128.bytes(c), bn128.bytes(s)];
}

utils.createAccount = () => {
    const x = bn128.randomScalar();
    const y = bn128.curve.g.mul(x); // y = x·G, 椭圆曲线bn128上的一点 (y.x, y.y)
    return { 'x': x, 'y': y };
};

utils.readBalance = (CL, CR, x) => {
    // 反序列化deserialize = 将字节数据转换为椭圆曲线点 (Red格式)
    CL = bn128.deserialize(CL); // Elgamal密文左分量, C[i]
    CR = bn128.deserialize(CR); // Elgamal密文右分量, D

    // 提取CL的坐标值（十六进制）
    const clXHex = CL.x.fromRed().toString(16);
    const clYHex = CL.y.fromRed().toString(16);
    console.log("CL.x (hex):", clXHex);
    console.log("CL.y (hex):", clYHex);

    // 提取CR的坐标值（十六进制）
    const crXHex = CR.x.fromRed().toString(16);
    const crYHex = CR.y.fromRed().toString(16);
    console.log("CR.x (hex):", crXHex);
    console.log("CR.y (hex):", crYHex);

    // 做椭圆曲线坐标上的运算, 也就是解密过程, g^B = C[i] + D*(-x) = adjustment*g + r*y[i] - x*r*g = adjustment*g (因为y = g*x)
    const gB = CL.add(CR.mul(x.redNeg())); // x.redNeg()是私钥x的负模值-x
    console.log("gB.x: ", gB.x.fromRed().toString(16));
    console.log("gB.y: ", gB.y.fromRed().toString(16));


    // 在椭圆曲线空间里搜索明文余额
    let accumulator = bn128.zero; // 从椭圆曲线零点开始
    for (let i = 0; i < bn128.B_MAX; i++) {
        if (accumulator.eq(gB)) 
            return i; // 找到余额 = i
        accumulator = accumulator.add(bn128.curve.g); // 累加基点G (什么是基点?)
    }
};

utils.mapInto = (seed) => { // seed is flattened 0x + hex string
    const seed_red = new BN(seed.slice(2), 16).toRed(bn128.p); // seed-> 模bn128.p的大整数
    const p_1_4 = bn128.curve.p.add(new BN(1)).div(new BN(4)); // 有限域上的(p+1)/4

    // 目标: 给定seed (x), 找到y满足椭圆曲线 y^2 \equiv x^3 + 3 \mod p, 返回(x, y)
    while (true) {
        const y_squared = seed_red.redPow(new BN(3)).redAdd(new BN(3).toRed(bn128.p)); // 计算y^2 = seed^3 + 3 \mod p
        const y = y_squared.redPow(p_1_4); // 计算平方根y = (seed^3 + 3)^{(p+1)/4} \mod p (仅当p \equiv 3 \mod 4有效). 
        if (y.redPow(new BN(2)).eq(y_squared)) {
            return bn128.curve.point(seed_red.fromRed(), y.fromRed()); // 验证y^2 \equiv seed^3 + 3 \mod p, 若成立返回(x, y)
        }
        seed_red.redIAdd(new BN(1).toRed(bn128.p));
    }
};

utils.gEpoch = (epoch) => {
    // hash("Zether" + epoch) -> 得到曲线点G_{epoch}
    return utils.mapInto(soliditySha3("Zether", epoch));
};

utils.u = (epoch, x) => {
    // 私钥 + epoch的加密标识: u = G_{epoch}·x
    return utils.gEpoch(epoch).mul(x);
};

utils.hash = (encoded) => { // ags are serialized
    return new BN(soliditySha3(encoded).slice(2), 16).toRed(bn128.q); // 用SHA3-256将encoded生成哈希值, 剔除0x前缀, 指定十六进制格式, 并将这个大整数转换为模bn128.q下的红黑树 (Red) 格式, 后续运算自动取模
};

module.exports = utils;