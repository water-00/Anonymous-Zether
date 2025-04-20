const ABICoder = require('web3-eth-abi');
const BN = require('bn.js');

const bn128 = require('../utils/bn128.js');
const utils = require('../utils/utils.js');
const { PedersenCommitment, ElGamal, PedersenVectorCommitment, FieldVector, PointVector, ElGamalVector } = require('../utils/algebra.js');
const { Convolver, FieldVectorPolynomial, Polynomial } = require('../utils/misc.js');
const InnerProductProof = require('./innerproduct.js');

class ZetherProof {
    constructor() {
        this.serialize = () => { // please initialize this before calling this method...
            let result = "0x";
            // 序列化初始承诺(BA, BS, A, B)
            result += bn128.representation(this.BA.point()).slice(2); // 去掉"0x"前缀
            result += bn128.representation(this.BS.point()).slice(2);
            result += bn128.representation(this.A.point()).slice(2);
            result += bn128.representation(this.B.point()).slice(2);

            // 序列化各种向量, 比如CnG应该是一个向量数组, 然后对每个元素的左右分量 (每个分量都是一个椭圆曲线点) 序列化
            // 这些变量都是从哪来的...
            this.CnG.forEach((CnG_k) => { result += bn128.representation(CnG_k.left()).slice(2); });
            this.CnG.forEach((CnG_k) => { result += bn128.representation(CnG_k.right()).slice(2); });
            this.C_0G.forEach((C_0G_k) => { result += bn128.representation(C_0G_k.left()).slice(2); });
            this.C_0G.forEach((C_0G_k) => { result += bn128.representation(C_0G_k.right()).slice(2); });
            this.y_0G.forEach((y_0G_k) => { result += bn128.representation(y_0G_k.left()).slice(2); });
            this.y_0G.forEach((y_0G_k) => { result += bn128.representation(y_0G_k.right()).slice(2); });
            this.C_XG.forEach((C_XG_k) => { result += bn128.representation(C_XG_k.left()).slice(2); });
            this.C_XG.forEach((C_XG_k) => { result += bn128.representation(C_XG_k.right()).slice(2); });
            this.f.getVector().forEach((f_k) => { result += bn128.bytes(f_k).slice(2); }); // 整数数组f的序列化

            result += bn128.bytes(this.z_A).slice(2);

            result += bn128.representation(this.T_1.point()).slice(2);
            result += bn128.representation(this.T_2.point()).slice(2);
            result += bn128.bytes(this.tHat).slice(2);
            result += bn128.bytes(this.mu).slice(2);

            result += bn128.bytes(this.c).slice(2);
            result += bn128.bytes(this.s_sk).slice(2);
            result += bn128.bytes(this.s_r).slice(2);
            result += bn128.bytes(this.s_b).slice(2);
            result += bn128.bytes(this.s_tau).slice(2);

            result += this.ipProof.serialize().slice(2);

            return result;
        };
    }

    static prove(statement, witness, fee) {
        const result = new ZetherProof();

        // 生成statement中所有元素的hash
        const statementHash = utils.hash(ABICoder.encodeParameters([
            'bytes32[2][]',
            'bytes32[2][]',
            'bytes32[2][]',
            'bytes32[2]',
            'bytes32[2][]',
            'uint256',
        ], [
            //  Cn[i]          = C[i] + balance[i]
            //  (nC[i], nD[i]) = (C[i], D) + (oC[i], oD[i])
            //                 = (y[i]*r + g*pl, g*r) + (y[i]*x + g*b[i], g*x)
            //                 = (y[i]*(r+x) + g*(pl+b[i]), g*(r+x))
            statement['Cn'].map((Cn_i) => bn128.serialize(Cn_i.left())), // 转账后余额
            statement['Cn'].map((Cn_i) => bn128.serialize(Cn_i.right())),
            statement['C'].map((C_i) => bn128.serialize(C_i.left())), // 转账金额
            bn128.serialize(statement['C'][0].right()),
            statement['y'].map((key) => bn128.serialize(key)),
            statement['epoch'],
        ]));

        // 转换为algebra.js中的El Gamal密文向量格式, 用于后续multiExponentiate计算
        statement['Cn'] = new ElGamalVector(statement['Cn']);
        // statement['C'] = new ElGamalVector(statement['C']);
        statement['y'] = new PointVector(statement['y']);
        witness['bTransfer'] = new BN(witness['bTransfer']).toRed(bn128.q);
        witness['bDiff'] = new BN(witness['bDiff']).toRed(bn128.q);

        const index = witness['index'];
        const key = statement['y'].getVector()[index[0]]; // 发送方的公钥
        // console.log("bTransfer: ", witness['bTransfer']); // 转账金额
        // console.log("bDiff: ", witness['bDiff']); // 发送方转账后余额
        const number = witness['bTransfer'].add(witness['bDiff'].shln(32)); // <bDiff左移32位> + <bTransfer>, 因为转账金额的最大值B_MAX = 2^32-1
        // console.log("number in prove(): ", number);
        const decomposition = number.toString(2, 64).split("").reverse(); // 把number数组化, 为什么要reverse?
        // console.log("decomposition in prove(): ", decomposition);

        const aL = new FieldVector(Array.from({ 'length': 64 }).map((_, i) => new BN(decomposition[i], 2).toRed(bn128.q))); // string[]->BN-R[], 元素是二进制
        const aR = aL.plus(new BN(1).toRed(bn128.q).redNeg()) // BN-R[], aR = aL - 1
        result.BA = PedersenVectorCommitment.commit(aL, aR); // BA = h*r + sum(al[i]*gs[i]) + sum(ar[i]*hs[i])
        const sL = new FieldVector(Array.from({ length: 64 }).map(bn128.randomScalar)); // 数组每个元素放一个2^256内的16进制随机数
        const sR = new FieldVector(Array.from({ length: 64 }).map(bn128.randomScalar));
        // console.log("sL: ", sL.getVector());
        // console.log("sR: ", sR.getVector());

        result.BS = PedersenVectorCommitment.commit(sL, sR);

        const N = statement['y'].length(); // statement['y']里是发起者+所有接收者的公钥
        if (N & (N - 1)) throw "Size must be a power of 2!"; // probably unnecessary... this won't be called directly.
        const m = new BN(N).bitLength() - 1; // assuming that N is a power of 2?
        const a = new FieldVector(Array.from({ 'length': 2 * m }).map(bn128.randomScalar)); // 2*m个2^256以内随机数
        // b = str(<接受者公钥的前m个bit>) + str(<发送者公钥的前m个bit>)再reverse, 所以最后是发送者公钥在前m
        const b = new FieldVector((new BN(witness['index'][1]).toString(2, m) + new BN(index[0]).toString(2, m)).split("").reverse().map((i) => new BN(i, 2).toRed(bn128.q))); // 
        const c = a.hadamard(b.times(new BN(2).toRed(bn128.q)).negate().plus(new BN(1).toRed(bn128.q))); // c = a⊙(-b*2 + 1) ?
        const d = a.hadamard(a).negate(); // d = -(a⊙a)
        const e = new FieldVector([a.getVector()[0].redMul(a.getVector()[m]), a.getVector()[0].redMul(a.getVector()[m])]); // [a[0]*a[m], a[0]*a[m]]
        const f = new FieldVector([a.getVector()[b.getVector()[0].toNumber() * m], a.getVector()[b.getVector()[m].toNumber() * m].redNeg()]); // [a[b[0]*m] * m, -a[b[m]*m] * m]
        result.A = PedersenVectorCommitment.commit(a, d.concat(e)); // warning: semantic change for contract
        result.B = PedersenVectorCommitment.commit(b, c.concat(f)); // warning: semantic change for contract

        // console.log("m: ", m);
        // console.log("a: ", a.getVector());
        // console.log("b: ", b.getVector());
        // console.log("c: ", c.getVector());
        // console.log("d: ", d.getVector());
        // console.log("e: ", e.getVector());
        // console.log("f: ", f.getVector());
        // console.log("d.concat(e): ", d.concat(e).getVector());
        // console.log("c.concat(f): ", c.concat(f).getVector());

        const v = utils.hash(ABICoder.encodeParameters([
            'bytes32',
            'bytes32[2]',
            'bytes32[2]',
            'bytes32[2]',
            'bytes32[2]',
        ], [
            bn128.bytes(statementHash),
            bn128.serialize(result.BA.point()),
            bn128.serialize(result.BS.point()),
            bn128.serialize(result.A.point()),
            bn128.serialize(result.B.point()),
        ]));

        const recursivePolynomials = (list, a, b) => {
            if (a.length === 0) 
                return list;
            const aTop = a.pop();
            const bTop = b.pop();
            // 每次记录根据b是0 or 1将多项式乘以X - f_k(x) or f_k(x)后的结果. 最后得到2^m = N个多项式结果.
            const left = new Polynomial([aTop.redNeg(), new BN(1).toRed(bn128.q).redSub(bTop)]); // X - f_k(X) = -a + (1 - b)x
            const right = new Polynomial([aTop, bTop]); // f_k(X) = a + bx
            for (let i = 0; i < list.length; i++) 
                list[i] = [list[i].mul(left), list[i].mul(right)];
            return recursivePolynomials(list.flat(), a, b);
            // final: len(list) = 2^m, 每个元素有(m+1)个系数, 对应x^0, ..., x^m的系数. 并且只有一个l使得list[m] = 1, 即x^m的系数是1
        }
        let P_poly = recursivePolynomials([new Polynomial([new BN(1).toRed(bn128.q)])], a.getVector().slice(0, m), b.getVector().slice(0, m)); 
        let Q_poly = recursivePolynomials([new Polynomial([new BN(1).toRed(bn128.q)])], a.getVector().slice(m), b.getVector().slice(m)); 
        // console.log("P: ", P_poly);
        // console.log("Q: ", Q_poly);

        // 取出2^m个多项式中x^0到x^(m-1)的系数, 不包括x^m的系数.
        // 一个长度为m的数组, 每个元素i放着2^m种情况下项(x^0, ..., x^(m-1))的所有可能的系数组合.
        /**         coff_1  coff_2  ...  coff_(2^m)
         * x^0
         * x^1
         * ...
         * x^(m-1)
         */
        P_poly = Array.from({ length: m }).map((_, k) => new FieldVector(P_poly.map((P_i) => P_i.coefficients[k]))); // sender
        Q_poly = Array.from({ length: m }).map((_, k) => new FieldVector(Q_poly.map((Q_i) => Q_i.coefficients[k]))); // receiver
        // console.log("P_poly: ", P_poly.map((P_i) => P_i.getVector()));
        // console.log("Q_poly: ", Q_poly.map((Q_i) => Q_i.getVector()));

        // 长度为m的数组, 每个元素都是对BN 0的ElGamal.commit: (C, D) = (g*0 + y*r, r*g)
        const Phi = Array.from({ length: m }).map(() => ElGamal.commit(key, new BN(0).toRed(bn128.q)));
        const Chi = Array.from({ length: m }).map(() => ElGamal.commit(key, new BN(0).toRed(bn128.q)));
        const Psi = Array.from({ length: m }).map(() => ElGamal.commit(key, new BN(0).toRed(bn128.q)));

        // Cn长度是N = 2^m, 所以这里是把Cn与P_poly中的每一项的2^m种系数可能分别做multiExponentiate
        // console.log("Cn: ", statement['Cn'].getVector());
        result.CnG = Array.from({ length: m }).map((_, k) => statement['Cn'].multiExponentiate(P_poly[k]).add(Phi[k]));
        result.C_0G = Array.from({ length: m }).map((_, k) => {
            const left = new PointVector(statement['C'].map((C_i) => C_i.left())).multiExponentiate(P_poly[k]).add(Chi[k].left());
            return new ElGamal(left, Chi[k].right());
        });
        result.y_0G = Array.from({ length: m }).map((_, k) => {
            const left = statement['y'].multiExponentiate(P_poly[k]).add(Psi[k].left());
            return new ElGamal(left, Psi[k].right());
        });
        result.C_XG = Array.from({ length: m }).map(() => ElGamal.commit(statement['C'][0].right(), new BN(0).toRed(bn128.q)));

        let vPow = new BN(1).toRed(bn128.q);
        for (let i = 0; i < N; i++) { // could turn this into a complicated reduce, but...
            const poly = i % 2 ? Q_poly : P_poly; // clunky, i know, etc. etc.
            result.C_XG = result.C_XG.map((C_XG_k, k) => C_XG_k.plus(vPow.redMul(witness['bTransfer'].redNeg().redSub(new BN(fee).toRed(bn128.q)).redMul(poly[k].getVector()[(witness['index'][0] + N - (i - i % 2)) % N]).redAdd(witness['bTransfer'].redMul(poly[k].getVector()[(witness['index'][1] + N - (i - i % 2)) % N])))));
            if (i !== 0)
                vPow = vPow.redMul(v);
        }

        const w = utils.hash(ABICoder.encodeParameters([
            'bytes32',
            'bytes32[2][]',
            'bytes32[2][]',
            'bytes32[2][]',
            'bytes32[2][]',
            'bytes32[2][]',
            'bytes32[2][]',
            'bytes32[2][]',
            'bytes32[2][]',
        ], [
            bn128.bytes(v),
            result.CnG.map((CnG_k) => bn128.serialize(CnG_k.left())),
            result.CnG.map((CnG_k) => bn128.serialize(CnG_k.right())),
            result.C_0G.map((C_0G_k) => bn128.serialize(C_0G_k.left())),
            result.C_0G.map((C_0G_k) => bn128.serialize(C_0G_k.right())),
            result.y_0G.map((y_0G_k) => bn128.serialize(y_0G_k.left())),
            result.y_0G.map((y_0G_k) => bn128.serialize(y_0G_k.right())),
            result.C_XG.map((C_XG_k) => bn128.serialize(C_XG_k.left())),
            result.C_XG.map((C_XG_k) => bn128.serialize(C_XG_k.right())),
        ]));

        // verifier给出的挑战是w
        result.f = b.times(w).add(a); // f_k = b*w + a
        result.z_A = result.B.randomness.redMul(w).redAdd(result.A.randomness); // z_A = r_B * w + r_A

        const y = utils.hash(ABICoder.encodeParameters([
            'bytes32',
        ], [
            bn128.bytes(w), // that's it?
        ]));

        const ys = new FieldVector([new BN(1).toRed(bn128.q)]);
        for (let i = 1; i < 64; i++) { // it would be nice to have a nifty functional way of doing this.
            ys.push(ys.getVector()[i - 1].redMul(y)); // [1, y, y^2, ..., y^63]
        }
        const z = utils.hash(bn128.bytes(y)); // 就是一个哈希值
        const zs = [z.redPow(new BN(2)), z.redPow(new BN(3))]; // [z^2, z^3]
        const twos = []
        for (let i = 0; i < 32; i++) 
            twos[i] = new BN(1).shln(i).toRed(bn128.q); // [1, 2, 2^2, ..., 2^31]
        const twoTimesZs = new FieldVector([]);
        for (let i = 0; i < 2; i++) {
            for (let j = 0; j < 32; j++) {
                twoTimesZs.push(zs[i].redMul(twos[j])); // [z^2 * 1, ..., z^2 * 2^31, z^3 * 1, ..., z^3 * 2^31]
            }
        }


        const lPoly = new FieldVectorPolynomial(aL.plus(z.redNeg()), sL); // aL - z + sL * x
        const rPoly = new FieldVectorPolynomial(ys.hadamard(aR.plus(z)).add(twoTimesZs), sR.hadamard(ys)); // ys ⊙ (aR + z) + twoTimesZs + sR ⊙ ys * x
        const tPolyCoefficients = lPoly.innerProduct(rPoly); // just an array of BN Reds... should be length 3: t0 + t1 * x + t2 * x^2
        result.T_1 = PedersenCommitment.commit(tPolyCoefficients[1]);
        result.T_2 = PedersenCommitment.commit(tPolyCoefficients[2]);

        // console.log("ys: ", ys.getVector());
        // console.log("z: ", z);
        // console.log("al - z: ", aL.plus(z.redNeg()).getVector());
        // console.log("l(x): ", lPoly.getCoefficients()[0].getVector(), lPoly.getCoefficients()[1].getVector());
        // console.log("r(x): ", rPoly.getCoefficients()[0].getVector(), rPoly.getCoefficients()[1].getVector());


        // 最终挑战值, z, t1, t2能绑定前面一堆东西
        const x = utils.hash(ABICoder.encodeParameters([
            'bytes32',
            'bytes32[2]',
            'bytes32[2]',
        ], [
            bn128.bytes(z),
            bn128.serialize(result.T_1.point()),
            bn128.serialize(result.T_2.point()),
        ]));

        result.tHat = tPolyCoefficients[0].redAdd(tPolyCoefficients[1].redMul(x)).redAdd(tPolyCoefficients[2].redMul(x.redPow(new BN(2)))); //  t_0 + t_1 * x + t_2 * x^2
        const tauX = result.T_1.randomness.redMul(x).redAdd(result.T_2.randomness.redMul(x.redPow(new BN(2)))); // r_t1 * x + r_t2 * x^2
        result.mu = result.BA.randomness.redAdd(result.BS.randomness.redMul(x)); // r_BA + r_BS*x

        let CnR = new ElGamal(undefined, bn128.zero); // only need the RHS. this will give us CRnR
        let chi = new BN(0).toRed(bn128.q); // for DR
        let psi = new BN(0).toRed(bn128.q); // for gR
        let C_XR = new ElGamal(undefined, bn128.zero); // only need the RHS
        let p = new FieldVector(Array.from({ length: N }).map(() => new BN(0).toRed(bn128.q))); // evaluations of poly_0 and poly_1 at w.
        let q = new FieldVector(Array.from({ length: N }).map(() => new BN(0).toRed(bn128.q))); // verifier will compute these using f.

        let wPow = new BN(1).toRed(bn128.q);
        for (let k = 0; k < m; k++) {
            CnR = CnR.add(Phi[k].neg().mul(wPow));
            chi = chi.redAdd(Chi[k].randomness.redMul(wPow));
            psi = psi.redAdd(Psi[k].randomness.redMul(wPow));
            C_XR = C_XR.add(result.C_XG[k].neg().mul(wPow));
            p = p.add(P_poly[k].times(wPow));
            q = q.add(Q_poly[k].times(wPow));
            wPow = wPow.redMul(w);
        }
        CnR = CnR.add(statement['Cn'].getVector()[index[0]].mul(wPow));
        const DR = statement['C'][0].right().mul(wPow).add(bn128.curve.g.mul(chi.redNeg()));
        const gR = bn128.curve.g.mul(wPow.redSub(psi));
        p = p.add(new FieldVector(Array.from({ length: N }).map((_, i) => i === index[0] ? wPow : new BN().toRed(bn128.q))));
        q = q.add(new FieldVector(Array.from({ length: N }).map((_, i) => i === index[1] ? wPow : new BN().toRed(bn128.q))));

        const convolver = new Convolver();
        convolver.prepare(statement['y']);
        const y_p = convolver.convolution(p);
        const y_q = convolver.convolution(q);
        vPow = new BN(1).toRed(bn128.q);
        for (let i = 0; i < N; i++) {
            const y_poly = i % 2 ? y_q : y_p; // this is weird. stumped.
            C_XR = C_XR.add(new ElGamal(undefined, y_poly.getVector()[Math.floor(i / 2)].mul(vPow)));
            if (i > 0)
                vPow = vPow.redMul(v);
        }

        const k_sk = bn128.randomScalar();
        const k_r = bn128.randomScalar();
        const k_b = bn128.randomScalar();
        const k_tau = bn128.randomScalar();

        const A_y = gR.mul(k_sk);
        const A_D = bn128.curve.g.mul(k_r);
        const A_b = ElGamal.base['g'].mul(k_b).add(DR.mul(zs[0].redNeg()).add(CnR.right().mul(zs[1])).mul(k_sk));
        const A_X = C_XR.right().mul(k_r); // y_XR.mul(k_r);
        const A_t = ElGamal.base['g'].mul(k_b.redNeg()).add(PedersenCommitment.base['h'].mul(k_tau));
        const A_u = utils.gEpoch(statement['epoch']).mul(k_sk);

        result.c = utils.hash(ABICoder.encodeParameters([
            'bytes32',
            'bytes32[2]',
            'bytes32[2]',
            'bytes32[2]',
            'bytes32[2]',
            'bytes32[2]',
            'bytes32[2]',
        ], [
            bn128.bytes(x),
            bn128.serialize(A_y),
            bn128.serialize(A_D),
            bn128.serialize(A_b),
            bn128.serialize(A_X),
            bn128.serialize(A_t),
            bn128.serialize(A_u),
        ]));

        result.s_sk = k_sk.redAdd(result.c.redMul(witness['sk']));
        result.s_r = k_r.redAdd(result.c.redMul(witness['r']));
        result.s_b = k_b.redAdd(result.c.redMul(witness['bTransfer'].redMul(zs[0]).redAdd(witness['bDiff'].redMul(zs[1])).redMul(wPow)));
        result.s_tau = k_tau.redAdd(result.c.redMul(tauX.redMul(wPow)));

        const hOld = PedersenVectorCommitment.base['h'];
        const hsOld = PedersenVectorCommitment.base['hs'];
        const o = utils.hash(ABICoder.encodeParameters([
            'bytes32',
        ], [
            bn128.bytes(result.c),
        ]));
        PedersenVectorCommitment.base['h'] = PedersenVectorCommitment.base['h'].mul(o);
        PedersenVectorCommitment.base['hs'] = PedersenVectorCommitment.base['hs'].hadamard(ys.invert());

        const P = new PedersenVectorCommitment(bn128.zero); // P._commit(lPoly.evaluate(x), rPoly.evaluate(x), result.tHat);
        P.gValues = lPoly.evaluate(x);
        P.hValues = rPoly.evaluate(x);
        P.randomness = result.tHat;
        result.ipProof = InnerProductProof.prove(P, o);

        PedersenVectorCommitment.base['h'] = hOld;
        PedersenVectorCommitment.base['hs'] = hsOld;
        return result;
    }
}

module.exports = ZetherProof;