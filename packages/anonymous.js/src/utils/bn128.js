const BN = require('bn.js')
const EC = require('elliptic')
const crypto = require('crypto')

// 域模数, 定义有限域范围, 要求所有椭圆曲线的点(x, y)满足x, y < FIELD_MODULUS
const FIELD_MODULUS = new BN("30644e72e131a029b85045b68181585d97816a916871ca8d3c208c16d87cfd47", 16);
// 群模数, 椭圆曲线bn128的循环子群的阶, 即基点G的阶
const GROUP_MODULUS = new BN("30644e72e131a029b85045b68181585d2833e84879b9709143e1f593f0000001", 16);
const B_MAX = 4294967295; // balance的最大值, 2^32 - 1
const empty = "0x0000000000000000000000000000000000000000000000000000000000000000";
const bn128 = {};

// bn128方程: y^2 = x^3 + ax + b \mod FIELD_MODULUS, where a = 0, b = 3
// y^2 = x^3 + 3符合Koblitz Curve
bn128.curve = new EC.curve.short({
    a: '0',
    b: '3',
    p: FIELD_MODULUS,
    n: GROUP_MODULUS,
    gRed: false,
    // 基点G, bn128的生成元
    g: ['077da99d806abd13c9f15ece5398525119d11e11e9836b2ee7d23f6159ad87d4', '01485efa927f2ad41bff567eec88f32fb0a0f706588b4e41a8d587d008b7f875'],
    // bizarre that g is set equal to one of the pedersen base elements (G是Pedersen承诺的基?). actually in theory not necessary (though the verifier would have to change also).
    // g是PedersenCommitment中的g值, 但注释说这不是必须的, 为什么?
});

bn128.zero = bn128.curve.g.mul(0); // 无穷远点, 单位元

bn128.p = BN.red(bn128.curve.p);
bn128.q = BN.red(bn128.curve.n); // GROUP_MODULUS

bn128.randomScalar = () => new BN(crypto.randomBytes(32), 16).toRed(bn128.q); // 生成2^256内的随机数, 用16进制表示
bn128.bytes = (i) => "0x" + i.toString(16, 64); // 大整数i -> 0x + 64位16进制 构成的字符串
bn128.serialize = (point) => { // differs from point.encode('hex'). ethereum-compatible
    // 将椭圆曲线点转化为以太坊兼容的格式, 也就是0x + 64位16进制构成的字符串
    if (point.x === null && point.y === null) return [empty, empty]; // 无穷远点返回两个空字符串
    // console.log(point.getX().toString(16), point.getY().toString(16));
    return [bn128.bytes(point.getX()), bn128.bytes(point.getY())];
};
bn128.representation = (point) => { // essentially for serializing proofs...
    // 将椭圆曲线点转换为紧凑的字符串, 其实就是0x + 两个bn128.serialize(point)数字部分的拼接
    if (point.x === null && point.y === null) return empty + empty.slice(2);
    return bn128.bytes(point.getX()) + bn128.bytes(point.getY()).slice(2);
};
bn128.deserialize = (serialization) => {
    // 将 0x + 64位16进制数 的字符串格式转换回椭圆曲线点. 潜在问题: 可能未验证点是否在curve上, 需要上层逻辑确保正确输入
    if (serialization[0] === empty && serialization[1] === empty) return bn128.zero;
    return bn128.curve.point(serialization[0].slice(2), serialization[1].slice(2)); // no check if valid curve point?
};

bn128.B_MAX = B_MAX;

module.exports = bn128;