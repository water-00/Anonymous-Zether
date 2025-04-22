const ABICoder = require('web3-eth-abi');
const BN = require('bn.js');

const bn128 = require('../utils/bn128.js');
const utils = require('../utils/utils.js');
const { PedersenCommitment, ElGamal, PedersenVectorCommitment, FieldVector, PointVector, ElGamalVector, PedersenLongVectorCommitment } = require('../utils/algebra.js');
const { Convolver, FieldVectorPolynomial, Polynomial } = require('../utils/misc.js');
const InnerProductProof = require('./innerproduct.js');

class ZetherProof {
    constructor() {
        this.A = null;    // 初始承诺
        this.S = null;    // 随机数承诺
        this.T1 = null;   // 多项式 t(X) 的 X 项承诺
        this.T2 = null;   // 多项式 t(X) 的 X^2 项承诺
        this.l = null;    // 左向量 l(X) 的评估值
        this.r = null;    // 右向量 r(X) 的评估值
        this.tHat = null; // 内积 tHat = <l, r>
        this.tauX = null; // 盲化因子 tau_x
        this.mu = null;   // 盲化因子 mu

    }

    static prove(statement, witness, fee) {
        const result = new ZetherProof();

        //  Cn[i]          = C[i] + balance[i]
        //  (nC[i], nD[i]) = (C[i], D) + (oC[i], oD[i])
        //                 = (y[i]*r + g*pl, g*r) + (y[i]*x + g*b[i], g*x)
        //                 = (y[i]*(r+x) + g*(pl+b[i]), g*(r+x))

        const n = 32;
        const m = witness.values.length;
        const nm = m * n;

        if (m & (m - 1)) throw "Size must be a power of 2!"; // probably unnecessary... this won't be called directly.

        const v = witness.values.map(val => new BN(val).toRed(bn128.q));
        const gamma = Array(m).fill(0).map(bn128.randomScalar);
        // 构造承诺V
        const commitment = new PedersenCommitment(bn128.zero);
        const V = v.map((v_i, i) => commitment._commit(v_i, gamma[i]));

        // 构造a_L
        let a_L = [];
        for (let j = 0; j < m; j++) {
            const bits = toBinary(v[j], n); // 将 v[j] 转换为 32 位二进制数组
            a_L = a_L.concat(bits);
        }
        a_L = new FieldVector(a_L.map(bit => new BN(bit).toRed(bn128.q)));

        // 构造a_R = a_L - 1
        const oneVec = new FieldVector(Array(nm).fill(new BN(1).toRed(bn128.q)));
        const a_R = a_L.add(oneVec.times(new BN(1).toRed(bn128.q).redNeg()));

        // 构造s_L, s_R
        const s_L = new FieldVector(Array(nm).fill(0).map(() => bn128.randomScalar()));
        const s_R = new FieldVector(Array(nm).fill(0).map(() => bn128.randomScalar()));

        // 构造承诺A, S
        const A = PedersenLongVectorCommitment.commit(a_L, a_R);
        const S = PedersenLongVectorCommitment.commit(s_L, s_R);
        const alpha = A.randomness;
        const rho = S.randomness;


        // Fiat-Shamir生成挑战y, z
        const y = utils.hash(ABICoder.encodeParameters([
            'bytes32[2]',
            'bytes32[2]',
            'bytes32',
        ], [
            bn128.serialize(A.point()),
            bn128.serialize(S.point()),
            bn128.bytes(1),
        ]));

        const z = utils.hash(ABICoder.encodeParameters([
            'bytes32[2]',
            'bytes32[2]',
            'bytes32',
        ], [
            bn128.serialize(A.point()),
            bn128.serialize(S.point()),
            bn128.bytes(2),
        ]));
        const yVec = new FieldVector(Array(nm).fill(0).map((_, i) => y.redPow(new BN(i))));

        // 构造多项式l(X), r(X)
        const l0 = a_L.add(oneVec.times(z.redNeg()));
        const l1 = s_L;
        const lPoly = new FieldVectorPolynomial(l0, l1); // aL - z + sL * x

        const twoVec = new FieldVector(Array(n).fill(0).map((_, i) => new BN(2).toRed(bn128.q).redPow(new BN(i))));
        let rSumTerm = new FieldVector(Array(nm).fill(new BN(0).toRed(bn128.q)));
        for (let j = 0; j < m; j++) {
            const zPow = z.redPow(new BN(j + 1));
            const segment = Array(nm).fill(new BN(0).toRed(bn128.q));
            segment.splice(j * n, n, ...twoVec.getVector());
            rSumTerm = rSumTerm.add(new FieldVector(segment).times(zPow));
        }
        const r0 = yVec.hadamard(a_R.add(oneVec.times(z))).add(rSumTerm);
        const r1 = yVec.hadamard(s_R);
        const rPoly = new FieldVectorPolynomial(r0, r1);

        // 构造承诺T1, T2
        const tPolyCoefficients = lPoly.innerProduct(rPoly); // just an array of BN Reds... should be length 3: t0 + t1 * x + t2 * x^2
        const T1 = PedersenCommitment.commit(tPolyCoefficients[1]);
        const T2 = PedersenCommitment.commit(tPolyCoefficients[2]);
        const tau1 = T1.randomness;
        const tau2 = T2.randomness;

        // Fiat-Shamir生成挑战x
        const x = utils.hash(ABICoder.encodeParameters([
            'bytes32',
            'bytes32[2]',
            'bytes32[2]',
        ], [
            bn128.bytes(z),
            bn128.serialize(T1.point()),
            bn128.serialize(T2.point()),
        ]));

        // 计算响应
        const l = lPoly.evaluate(x);
        const r = rPoly.evaluate(x);
        const tHat = tPolyCoefficients[0].redAdd(tPolyCoefficients[1].redMul(x)).redAdd(tPolyCoefficients[2].redMul(x.redPow(new BN(2))));
        let tauX = tau1.redMul(x).redAdd(tau2.redMul(x.redPow(new BN(2)))); // tau1 * x + tau2 * x^2
        for (let j = 0; j < m; j++) {
            tauX = tauX.redAdd(z.redPow(new BN(j + 1)).redMul(gamma[j]));
        }
        const mu = alpha.redAdd(rho.redMul(x));

        // 内积证明部分
        const { h: hOld, hs: hsOld } = PedersenLongVectorCommitment.getBaseValues(nm);
        const ys = new FieldVector([new BN(1).toRed(bn128.q)]);
        for (let i = 1; i < nm; i++) {
            ys.push(ys.getVector()[i - 1].redMul(y)); // [1, y, y^2, ..., y^(nm-1)]
        }
        const o = utils.hash(ABICoder.encodeParameters([
            'bytes32',
        ], [
            bn128.bytes(x),
        ]));

        // 修改 h 和 hs
        const newH = hOld.mul(o);
        const newHs = hsOld.hadamard(ys.invert());
        PedersenLongVectorCommitment.setBaseValues(nm, newH, newHs);

        const P = new PedersenLongVectorCommitment(bn128.zero, nm);
        P.gValues = lPoly.evaluate(x);
        P.hValues = rPoly.evaluate(x);
        P.randomness = tHat;
        const ipProof = InnerProductProof.prove(P, o);

        // 恢复原始值
        PedersenLongVectorCommitment.setBaseValues(nm, hOld, hsOld);


        // PriDe CT协议
        const sk = witness.sk;
        const r_witness = witness.r;
        const values = witness.values;
        const Cn = statement.Cn;
        const C = statement.C;

        // 1. 生成随机数 k_sk, k_r, k_b, k_τ
        const k_sk = bn128.randomScalar();
        const k_r = bn128.randomScalar();
        const k_b = bn128.randomScalar();
        const k_tau = bn128.randomScalar();

        // 2. 计算承诺
        const g = bn128.curve.g;
        const h = PedersenCommitment.base['h'];

        const A_C = g.mul(k_r);
        const A_y = g.mul(k_sk);

        // C^{-z^2}
        const C0 = C[0].right(); // PriDe CT中的C在代码中是C[0].right() = D
        const z_squared = z.redPow(new BN(2));
        const C_neg_z2 = C0.mul(z_squared.redNeg());

        // nC_0^{z^{m+1}}
        const nC0 = Cn[0].right(); // PriDe CT中的nC_0在代码中是Cn[0].right() = nD
        const z_m_plus_1 = z.redPow(new BN(m + 1));
        const nC0_z_m_plus_1 = nC0.mul(z_m_plus_1);

        // (C^{-z^2} * nC_0^{z^{m+1}})^{k_sk}
        const term1 = C_neg_z2.add(nC0_z_m_plus_1).mul(k_sk);

        // g^{k_b}
        const term0 = g.mul(k_b);

        // \prod_{j=1}^m (pk_j)^{k_r * z^{2+j}}
        const pk_list = statement.y;
        let term2 = bn128.zero;
        for (let j = 1; j <= m; j++) {
            const exponent = k_r.redMul(z.redPow(new BN(2 + j)));
            const pk_j = pk_list[j - 1];
            const pk_j_power = pk_j.mul(exponent);
            term2 = term2 == bn128.zero ? pk_j_power : term2.add(pk_j_power);
        }

        // A_b = term0 * term1 * term2
        const A_b = term0.add(term1).add(term2);

        // A_X = (\prod_{j=0}^m pk_j)^{k_r}
        let A_X_term = bn128.zero;
        for (let j = 0; j < m; j++) {
            const pk_j = pk_list[j];
            const pk_j_power = pk_j.mul(k_r);
            A_X_term = A_X_term == bn128.zero ? pk_j_power : A_X_term.add(pk_j_power);
        }
        const A_X = A_X_term;

        // A_tau = g^{-k_b} * h^{k_tau}
        const g_neg_k_b = g.mul(k_b.redNeg());
        const h_k_tau = h.mul(k_tau);
        const A_tau = g_neg_k_b.add(h_k_tau);

        // 3. Fiat-Shamir 挑战 c
        const c = utils.hash(ABICoder.encodeParameters([
            'bytes32',
            'bytes32',
            'bytes32[2]',
            'bytes32[2]',
            'bytes32[2]',
            'bytes32[2]',
            'bytes32[2]',
        ], [
            bn128.bytes(tHat),
            bn128.bytes(mu),
            bn128.serialize(A_C),
            bn128.serialize(A_y),
            bn128.serialize(A_b),
            bn128.serialize(A_X),
            bn128.serialize(A_tau),
        ]));

        // 4. 计算响应
        const s_sk = k_sk.redAdd(c.redMul(sk));
        const s_r = k_r.redAdd(c.redMul(r_witness));

        // s_b = k_b + c * Σ_{j=1}^m z^{1+j} * pl_{j-1}
        let sum_pl = new BN(0).toRed(bn128.q);
        for (let j = 1; j <= m; j++) {
            const pl_j_minus_1 = new BN(values[j - 1]).toRed(bn128.q);
            const coeff = z.redPow(new BN(j + 1));
            sum_pl = sum_pl.redAdd(coeff.redMul(pl_j_minus_1));
        }
        const s_b = k_b.redAdd(c.redMul(sum_pl));

        // s_tau = k_tau + c * tauX
        const s_tau = k_tau.redAdd(c.redMul(tauX));

        // 存储证明结果
        result.A = A;
        result.S = S;
        result.T1 = T1;
        result.T2 = T2;
        result.l = l;
        result.r = r;
        result.tHat = tHat;
        result.tauX = tauX;
        result.mu = mu;
        result.ipProof = ipProof;

        result.A_C = A_C;
        result.A_y = A_y;
        result.A_b = A_b;
        result.A_X = A_X;
        result.A_tau = A_tau;
        result.c = c;
        result.s_sk = s_sk;
        result.s_r = s_r;
        result.s_b = s_b;
        result.s_tau = s_tau;

        console.log("result: ", result);
        return result;
    }


    serialize() {
        let result = "0x";

        // Bulletproof部分
        result += bn128.representation(this.A.point()).slice(2);
        result += bn128.representation(this.S.point()).slice(2);
        result += bn128.representation(this.T1.point()).slice(2);
        result += bn128.representation(this.T2.point()).slice(2);
        result += bn128.bytes(this.tHat).slice(2);
        result += bn128.bytes(this.mu).slice(2);

        // PriDe CT部分
        result += bn128.representation(this.A_C).slice(2);
        result += bn128.representation(this.A_y).slice(2);
        result += bn128.representation(this.A_b).slice(2);
        result += bn128.representation(this.A_X).slice(2);
        result += bn128.representation(this.A_tau).slice(2);
        result += bn128.bytes(this.c).slice(2);
        result += bn128.bytes(this.s_sk).slice(2);
        result += bn128.bytes(this.s_r).slice(2);
        result += bn128.bytes(this.s_b).slice(2);
        result += bn128.bytes(this.s_tau).slice(2);

        // 内积证明
        result += this.ipProof.serialize().slice(2);

        return result;
    }
}

function toBinary(value, n) {
    const bits = [];
    for (let i = 0; i < n; i++) {
        bits.push(value.testn(i) ? 1 : 0); // 检查第 i 位是否为 1
    }
    return bits;
}

module.exports = ZetherProof;