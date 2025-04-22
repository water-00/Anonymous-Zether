const ABICoder = require('web3-eth-abi');
const { PedersenLongVectorCommitment, FieldVector, PointVector } = require('../utils/algebra.js');
const bn128 = require('../utils/bn128.js');
const utils = require('../utils/utils.js');

class InnerProductProof {
    constructor() {
        this.L = []; // 存储每次递归的 L 值
        this.R = []; // 存储每次递归的 R 值
        this.a = null; // 最终的 a 值
        this.b = null; // 最终的 b 值

        this.serialize = () => {
            let result = "0x";
            this.L.forEach((l) => { result += bn128.representation(l).slice(2); });
            this.R.forEach((r) => { result += bn128.representation(r).slice(2); });
            result += bn128.bytes(this.a).slice(2);
            result += bn128.bytes(this.b).slice(2);
            return result;
        };
    }

    static prove(commitment, salt) {
        const result = new InnerProductProof();
        result.L = [];
        result.R = [];

        const recursiveProof = (result, as, bs, previousChallenge, n) => {
            if (as.length() !== n || bs.length() !== n) {
                throw new Error("向量长度不匹配");
            }

            if (as.length() === 1) {
                result.a = as.getVector()[0];
                result.b = bs.getVector()[0];
                return;
            }

            const nPrime = n / 2;
            if (nPrime !== Math.floor(nPrime)) {
                throw new Error("向量长度必须是 2 的幂");
            }

            const asLeft = as.slice(0, nPrime);
            const asRight = as.slice(nPrime);
            const bsLeft = bs.slice(0, nPrime);
            const bsRight = bs.slice(nPrime);

            // 获取当前长度 n 的基
            const { gs: gsFull, hs: hsFull, h } = PedersenLongVectorCommitment.getBase(n);
            const gsLeft = gsFull.slice(0, nPrime);
            const gsRight = gsFull.slice(nPrime);
            const hsLeft = hsFull.slice(0, nPrime);
            const hsRight = hsFull.slice(nPrime);

            // 计算 L 和 R
            const cL = asLeft.innerProduct(bsRight);
            const cR = asRight.innerProduct(bsLeft);
            const L = gsRight.multiExponentiate(asLeft)
                .add(hsLeft.multiExponentiate(bsRight))
                .add(h.mul(cL));
            const R = gsLeft.multiExponentiate(asRight)
                .add(hsRight.multiExponentiate(bsLeft))
                .add(h.mul(cR));
            result.L.push(L);
            result.R.push(R);

            // Fiat-Shamir 挑战 x
            const x = utils.hash(ABICoder.encodeParameters([
                'bytes32',
                'bytes32[2]',
                'bytes32[2]',
            ], [
                bn128.bytes(previousChallenge),
                bn128.serialize(L),
                bn128.serialize(R),
            ]));

            const xInv = x.redInvm();

            // 计算新的 gs 和 hs（长度为 nPrime）
            const gsPrime = gsLeft.times(xInv).add(gsRight.times(x));
            const hsPrime = hsLeft.times(x).add(hsRight.times(xInv));

            // 更新长度为 nPrime 的基
            const { h: hOldPrime, hs: hsOldPrime } = PedersenLongVectorCommitment.getBaseValues(nPrime);
            PedersenLongVectorCommitment.setBaseValues(nPrime, h, hsPrime);

            // 计算新的 as 和 bs
            const asPrime = asLeft.times(x).add(asRight.times(xInv));
            const bsPrime = bsLeft.times(xInv).add(bsRight.times(x));

            // 递归调用
            recursiveProof(result, asPrime, bsPrime, x, nPrime);

            // 恢复长度为 nPrime 的基
            PedersenLongVectorCommitment.setBaseValues(nPrime, hOldPrime, hsOldPrime);
        };

        const n = commitment.gValues.length();
        recursiveProof(result, commitment.gValues, commitment.hValues, salt, n);
        return result;
    }
}

module.exports = InnerProductProof;