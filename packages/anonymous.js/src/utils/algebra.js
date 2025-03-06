const { soliditySha3 } = require('web3-utils');
const BN = require('bn.js');

const bn128 = require('../utils/bn128.js');
const utils = require('../utils/utils.js');

class PedersenCommitment {
    static base = {
        // g和h的生成方法: 对"G", "H"取哈希, 然后丢给utils.mapInt, 得到椭圆曲线群循环中的一个点: (hash("G"), y) such that y^2 \equiv x^3 + 3 \mod p
        // soliditySha3应该就是keccak256, output是32字节 (256 bit)
        // 得到的g, h类型是bn128.curve.point(x: BNInput, y: BNInput, isRed?: boolean): short.ShortPoint
        'g': utils.mapInto(soliditySha3("G")),
        'h': utils.mapInto(soliditySha3("H")),
    }
    
    constructor(point) {
        this._commit = (value, randomness) => { // 两个参数都是已经处理过的BN类型
            this.randomness = randomness;
            // (p.x, p.y) = (g.x, g.y) * value + (h.x, h.y) * randomness
            point = PedersenCommitment.base['g'].mul(value).add(PedersenCommitment.base['h'].mul(randomness));
        };
        this.point = () => point;
    }

    static commit(value) { // an already-reduced BN
        const result = new PedersenCommitment(bn128.zero);
        result._commit(value, bn128.randomScalar());
        return result;
    }
}
class FieldVector {
    constructor(vector) {
        this.getVector = () => vector;
        this.length = () => vector.length;
        this.slice = (begin, end) => new FieldVector(vector.slice(begin, end));
        this.flip = () => new FieldVector(Array.from({ length: this.length() }).map((_, i) => vector[(this.length() - i) % this.length()]));
        this.extract = (parity) => new FieldVector(vector.filter((_, i) => i % 2 === parity));
        this.add = (other) => new FieldVector(other.getVector().map((elem, i) => vector[i].redAdd(elem)))
        this.negate = () => new FieldVector(vector.map((elem) => elem.redNeg()));
        this.plus = (constant) => new FieldVector(vector.map((elem) => elem.redAdd(constant)));
        this.push = (constant) => { vector.push(constant); };
        this.sum = () => vector.reduce((accum, cur) => accum.redAdd(cur), new BN(0).toRed(bn128.q));
        this.hadamard = (other) => new FieldVector(other.getVector().map((elem, i) => vector[i].redMul(elem)));
        this.invert = () => new FieldVector(vector.map((elem) => elem.redInvm()));
        this.times = (constant) => new FieldVector(vector.map((elem) => elem.redMul(constant)));
        this.innerProduct = (other) => other.getVector().reduce((accum, cur, i) => accum.redAdd(vector[i].redMul(cur)), new BN(0).toRed(bn128.q));
        this.concat = (other) => new FieldVector(vector.concat(other.getVector()));
    }
}

class PointVector {
    constructor(vector) {
        this.getVector = () => vector;
        this.length = () => vector.length;
        this.slice = (begin, end) => new PointVector(vector.slice(begin, end));
        this.flip = () => new PointVector(Array.from({ length: this.length() }).map((_, i) => vector[(this.length() - i) % this.length()]));
        this.extract = (parity) => new PointVector(vector.filter((_, i) => i % 2 === parity));
        this.negate = () => new PointVector(vector.map((elem) => elem.neg()));
        // accum = sum(vector[i] * exponents[i])
        this.multiExponentiate = (exponents) => exponents.getVector().reduce((accum, cur, i) => accum.add(vector[i].mul(cur)), bn128.zero);
        this.sum = () => vector.reduce((accum, cur) => accum.add(cur), bn128.zero);
        this.add = (other) => new PointVector(other.getVector().map((elem, i) => vector[i].add(elem)));
        this.hadamard = (exponents) => new PointVector(exponents.getVector().map((elem, i) => vector[i].mul(elem)));
        this.times = (constant) => new PointVector(vector.map((elem) => elem.mul(constant)));
        this.concat = (other) => new PointVector(vector.concat(other.getVector()));
    }
}

class ElGamalVector {
    constructor(vector) {
        this.getVector = () => vector;
        this.multiExponentiate = (exponents) => exponents.getVector().reduce((accum, cur, i) => accum.add(vector[i].mul(cur)), new ElGamal(bn128.zero, bn128.zero));
        this.sum = () => vector.reduce((accum, cur) => accum.add(cur), new ElGamal(bn128.zero, bn128.zero));
        this.add = (other) => new ElGamalVector(other.getVector().map((elem, i) => vector[i].add(elem)));
        this.hadamard = (exponents) => new ElGamalVector(exponents.getVector().map((elem, i) => vector[i].mul(elem)));
        this.times = (constant) => new ElGamalVector(vector.map((elem) => elem.mul(constant)));
    }
}

class PedersenVectorCommitment {
    static base = { // hardcode length 64 for zether
        // gs中的每个元素是不同的, 相当于把字符"G"和整数i连接然后取哈希
        'gs': new PointVector(Array.from({ 'length': 64 }).map((_, i) => utils.mapInto(soliditySha3("G", i)))),
        'hs': new PointVector(Array.from({ 'length': 64 }).map((_, i) => utils.mapInto(soliditySha3("H", i)))),
        'h': utils.mapInto(soliditySha3("H")),
    };
    static sum = PedersenVectorCommitment.base['gs'].sum(); // KLUDGY.

    constructor(point) {
        this._commit = (gValues, hValues, randomness) => { // first args of type FieldVector?!
            // console.log("检查 gs 和 hs 的内容：");
            // console.log("gs[0]:", PedersenVectorCommitment.base['gs'].getVector()[0].getX().toString());
            // console.log("gs[0]:", PedersenVectorCommitment.base['gs'].getVector()[0].getY().toString());
            // console.log("gs[1]:", PedersenVectorCommitment.base['gs'].getVector()[1].getX().toString());
            // console.log("gs[1]:", PedersenVectorCommitment.base['gs'].getVector()[1].getY().toString());
            // console.log("hs[0]:", PedersenVectorCommitment.base['hs'].getVector()[0].getX().toString());
            // console.log("hs[0]:", PedersenVectorCommitment.base['hs'].getVector()[0].getY().toString());
            // console.log("hs[1]:", PedersenVectorCommitment.base['hs'].getVector()[1].getX().toString());
            // console.log("hs[1]:", PedersenVectorCommitment.base['hs'].getVector()[1].getY().toString());

            this.gValues = gValues;
            this.hValues = hValues;
            this.randomness = randomness;
            point = PedersenVectorCommitment.base['h'].mul(randomness); // h*r
            point = point.add(PedersenVectorCommitment.base['gs'].multiExponentiate(gValues)); // sum(gValues[i]*gs[i])
            point = point.add(PedersenVectorCommitment.base['hs'].multiExponentiate(hValues)); // sum(hValues[i]*hs[i])
        };
        this.point = () => point;
    }

    static commit(gValues, hValues) { // vectors of already-reduced BNs
        const result = new PedersenVectorCommitment(bn128.zero);
        result._commit(gValues, hValues, bn128.randomScalar());
        return result;
    }
}

class ElGamal {
    static base = {
        'g': PedersenCommitment.base['g'], // only used for messages.
    }

    constructor(left, right) {
        this._commit = (key, value, randomness) => {
            this.randomness = randomness;
            left = ElGamal.base['g'].mul(value).add(key.mul(randomness)); // g*value + y*r, g*value大概就是把整数value转换成椭圆曲线群内的一个值 (m映射到群中的m'), key大概就是公钥
            right = bn128.curve.g.mul(randomness); // r*g
        };
        // left和right都是bn128.curve.point类型
        this.left = () => left
        this.right = () => right;
        this.zero = () => left.eq(bn128.zero) && right.eq(bn128.zero);
        this.add = (other) => new ElGamal(left === undefined ? undefined : left.add(other.left()), right.add(other.right()));
        this.mul = (scalar) => new ElGamal(left.mul(scalar), right.mul(scalar));
        this.plus = (constant) => new ElGamal(left.add(ElGamal.base['g'].mul(constant)), right); // affine
        this.neg = () => new ElGamal(left.neg(), right.neg());
    }

    static commit(key, value) { // value is a BN; we will exponentiate.
        const result = new ElGamal(bn128.zero, bn128.zero);
        result._commit(key, value, bn128.randomScalar());
        return result;
    }

    static deserialize(account) {
        // console.log(bn128.deserialize(account[0]));
        // console.log(bn128.deserialize(account[1]));
        return new ElGamal(bn128.deserialize(account[0]), bn128.deserialize(account[1]));
    }
}

module.exports = { PedersenCommitment, PedersenVectorCommitment, ElGamal, FieldVector, PointVector, ElGamalVector };