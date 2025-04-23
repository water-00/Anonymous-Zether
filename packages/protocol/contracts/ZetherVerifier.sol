// SPDX-License-Identifier: Apache License 2.0
pragma solidity ^0.7.0;
pragma experimental ABIEncoderV2;

import "./Utils.sol";
import "./InnerProductVerifier.sol";

contract ZetherVerifier {
    using Utils for uint256;
    using Utils for Utils.G1Point;

    InnerProductVerifier ip;
    uint256 public constant fee = 0; // set this to be the "transaction fee". can be any integer under MAX.

    constructor(address _ip) {
        ip = InnerProductVerifier(_ip);
    }

    struct ZetherStatement {
        Utils.G1Point[] CLn;
        Utils.G1Point[] CRn;
        Utils.G1Point[] C;  // 转账承诺
        Utils.G1Point D;   // 随机数承诺
        Utils.G1Point[] y; // 公钥列表
        uint256 epoch;
        Utils.G1Point u;
    }

    struct ZetherProof {
        Utils.G1Point BA;    // Bulletproof 的 A
        Utils.G1Point BS;    // Bulletproof 的 S
        Utils.G1Point T_1;   // T1
        Utils.G1Point T_2;   // T2
        uint256 tHat;        // tHat
        uint256 mu;          // mu
        Utils.G1Point A_C;   // Sigma 的 A_C
        Utils.G1Point A_y;   // Sigma 的 A_y
        Utils.G1Point A_b;   // Sigma 的 A_b
        Utils.G1Point A_X;   // Sigma 的 A_X
        Utils.G1Point A_tau; // Sigma 的 A_tau
        uint256 c;           // Sigma 挑战
        uint256 s_sk;        // Sigma 响应 s_sk
        uint256 s_r;         // Sigma 响应 s_r
        uint256 s_b;         // Sigma 响应 s_b
        uint256 s_tau;       // Sigma 响应 s_tau
        InnerProductVerifier.InnerProductProof ipProof; // 内积证明
    }

    function verifyTransfer(ZetherStatement memory statement, bytes memory proof) public view returns (bool) {
        ZetherProof memory zetherProof = unserialize(proof);
        return verify(statement, zetherProof);
    }

    struct ZetherAuxiliaries {
        uint256 y;
        uint256[64] ys;
        uint256 z;
        uint256[16] zs; // [z, z^2, z^3, ..., z^{m+2}]，假设 m <= 14
        uint256[64] twoTimesZSquared;
        uint256 zSum;
        uint256 x;
        uint256 t;
        uint256 k;
        Utils.G1Point tEval;
    }

    struct SigmaAuxiliaries {
        uint256 c;
        Utils.G1Point A_y;
        Utils.G1Point A_C;
        Utils.G1Point A_b;
        Utils.G1Point A_X;
        Utils.G1Point A_t;
    }

    struct IPAuxiliaries {
        Utils.G1Point P;
        Utils.G1Point u_x;
        Utils.G1Point[] hPrimes;
        Utils.G1Point hPrimeSum;
        uint256 o;
    }

    function gSum() internal pure returns (Utils.G1Point memory) {
        return Utils.G1Point(
            0x00715f13ea08d6b51bedcde3599d8e12163e090921309d5aafc9b5bfaadbcda0,
            0x27aceab598af7bf3d16ca9d40fe186c489382c21bb9d22b19cb3af8b751b959f
        );
    }

    function verify(ZetherStatement memory statement, ZetherProof memory proof) internal view returns (bool) {
        ZetherAuxiliaries memory zetherAuxiliaries;
        // 计算挑战 y
        zetherAuxiliaries.y = uint256(keccak256(abi.encode(proof.BA, proof.BS))).mod();
        zetherAuxiliaries.ys[0] = 1;
        for (uint256 i = 1; i < 64; i++) {
            zetherAuxiliaries.ys[i] = zetherAuxiliaries.ys[i - 1].mul(zetherAuxiliaries.y);
        }
        // 计算挑战 z
        zetherAuxiliaries.z = uint256(keccak256(abi.encode(proof.BA, proof.BS, 2))).mod();
        zetherAuxiliaries.zs[0] = zetherAuxiliaries.z;
        for (uint256 i = 1; i < 16; i++) {
            zetherAuxiliaries.zs[i] = zetherAuxiliaries.zs[i - 1].mul(zetherAuxiliaries.z);
        }
        // 计算 twoTimesZSquared
        for (uint256 i = 0; i < 32; i++) {
            zetherAuxiliaries.twoTimesZSquared[i] = zetherAuxiliaries.zs[1].mul(1 << i); // z^2 * 2^i
            zetherAuxiliaries.twoTimesZSquared[i + 32] = zetherAuxiliaries.zs[2].mul(1 << i); // z^3 * 2^i
        }
        // 计算 delta(y, z)
        zetherAuxiliaries.k = 1;
        for (uint256 i = 0; i < 64; i++) {
            zetherAuxiliaries.k = zetherAuxiliaries.k.add(zetherAuxiliaries.ys[i]);
        }
        zetherAuxiliaries.zSum = 0;
        for (uint256 j = 1; j <= statement.y.length; j++) {
            zetherAuxiliaries.zSum = zetherAuxiliaries.zSum.add(zetherAuxiliaries.zs[j + 1].mul(1 << 32));
        }
        zetherAuxiliaries.k = zetherAuxiliaries.k.mul(zetherAuxiliaries.z.sub(zetherAuxiliaries.zs[1])).sub(zetherAuxiliaries.zSum);
        zetherAuxiliaries.t = proof.tHat.sub(zetherAuxiliaries.k);
        // 计算挑战 x 和 tEval
        zetherAuxiliaries.x = uint256(keccak256(abi.encode(zetherAuxiliaries.z, proof.T_1, proof.T_2))).mod();
        zetherAuxiliaries.tEval = proof.T_1.mul(zetherAuxiliaries.x).add(proof.T_2.mul(zetherAuxiliaries.x.mul(zetherAuxiliaries.x)));

        // Sigma 协议验证
        SigmaAuxiliaries memory sigmaAuxiliaries;
        sigmaAuxiliaries.A_y = Utils.g().mul(proof.s_sk).add(statement.y[0].mul(proof.c.neg()));
        sigmaAuxiliaries.A_C = Utils.g().mul(proof.s_r).add(statement.D.mul(proof.c.neg()));
        
        // 计算 A_b
        Utils.G1Point memory left = statement.D.mul(zetherAuxiliaries.zs[1].neg()).add(statement.C[0].mul(zetherAuxiliaries.zs[statement.y.length])); // C^{-z^2} * nC_0^{z^{m+1}}
        Utils.G1Point memory right = statement.D.mul(zetherAuxiliaries.zs[1].neg()).add(statement.D.mul(zetherAuxiliaries.zs[statement.y.length])); // D_0^{-z^2} * D_0'^{z^{m+1}}
        Utils.G1Point memory prod = Utils.G1Point(0, 0);
        for (uint256 j = 1; j < statement.y.length; j++) {
            Utils.G1Point memory term = statement.y[j].mul(proof.s_r).add(statement.C[j].mul(proof.c.neg()));
            prod = prod.add(term.mul(zetherAuxiliaries.zs[j + 1]));
        }
        sigmaAuxiliaries.A_b = Utils.g().mul(proof.s_b).add(left.mul(proof.s_sk).add(right.mul(proof.c.neg())).add(prod));
        
        sigmaAuxiliaries.A_X = statement.y[0].mul(proof.s_r);
        for (uint256 j = 1; j < statement.y.length; j++) {
            sigmaAuxiliaries.A_X = sigmaAuxiliaries.A_X.add(statement.y[j].mul(proof.s_r));
        }
        Utils.G1Point memory D_prod = statement.D.mul(proof.c.neg());
        for (uint256 j = 1; j < statement.C.length; j++) {
            D_prod = D_prod.add(statement.C[j].mul(proof.c.neg()));
        }
        sigmaAuxiliaries.A_X = sigmaAuxiliaries.A_X.add(D_prod);
        
        sigmaAuxiliaries.A_t = Utils.g().mul(proof.c.mul(proof.tHat)).add(Utils.h().mul(proof.s_tau)).add(Utils.g().mul(zetherAuxiliaries.t.mul(proof.c)).add(proof.A_tau).add(zetherAuxiliaries.tEval.mul(proof.c)).neg());
        
        sigmaAuxiliaries.c = uint256(keccak256(abi.encode(zetherAuxiliaries.x, sigmaAuxiliaries.A_y, sigmaAuxiliaries.A_C, sigmaAuxiliaries.A_b, sigmaAuxiliaries.A_X, sigmaAuxiliaries.A_t))).mod();
        require(sigmaAuxiliaries.c == proof.c, "Sigma protocol challenge equality failure.");

        // Bulletproof 验证
        IPAuxiliaries memory ipAuxiliaries;
        ipAuxiliaries.o = uint256(keccak256(abi.encode(sigmaAuxiliaries.c))).mod();
        ipAuxiliaries.u_x = Utils.h().mul(ipAuxiliaries.o);
        ipAuxiliaries.hPrimes = new Utils.G1Point[](64);
        ipAuxiliaries.hPrimeSum = Utils.G1Point(0, 0);
        for (uint256 i = 0; i < 64; i++) {
            ipAuxiliaries.hPrimes[i] = ip.hs(i).mul(zetherAuxiliaries.ys[i].inv());
            ipAuxiliaries.hPrimeSum = ipAuxiliaries.hPrimeSum.add(ipAuxiliaries.hPrimes[i].mul(zetherAuxiliaries.ys[i].mul(zetherAuxiliaries.z).add(zetherAuxiliaries.twoTimesZSquared[i])));
        }

        // 超出EVM栈深度限制所以P只能分开来写
        ipAuxiliaries.P = proof.BA; // 初始化 P
        ipAuxiliaries.P = ipAuxiliaries.P.add(proof.BS.mul(zetherAuxiliaries.x)); // P = P + (BS * x)
        ipAuxiliaries.P = ipAuxiliaries.P.add(gSum().mul(zetherAuxiliaries.z.neg())); // P = P + (gSum * (-z))
        ipAuxiliaries.P = ipAuxiliaries.P.add(ipAuxiliaries.hPrimeSum); // P = P + hPrimeSum
        ipAuxiliaries.P = ipAuxiliaries.P.add(Utils.h().mul(proof.mu.neg())); // P = P + (h * (-mu))
        ipAuxiliaries.P = ipAuxiliaries.P.add(ipAuxiliaries.u_x.mul(proof.tHat)); // P = P + (u_x * tHat)
        require(ip.verifyInnerProduct(ipAuxiliaries.hPrimes, ipAuxiliaries.u_x, ipAuxiliaries.P, proof.ipProof, ipAuxiliaries.o), "Inner product proof verification failed.");

        return true;
    }

    function unserialize(bytes memory arr) internal pure returns (ZetherProof memory proof) {
        proof.BA = Utils.G1Point(Utils.slice(arr, 0), Utils.slice(arr, 32));
        proof.BS = Utils.G1Point(Utils.slice(arr, 64), Utils.slice(arr, 96));
        proof.T_1 = Utils.G1Point(Utils.slice(arr, 128), Utils.slice(arr, 160));
        proof.T_2 = Utils.G1Point(Utils.slice(arr, 192), Utils.slice(arr, 224));
        proof.tHat = uint256(Utils.slice(arr, 256));
        proof.mu = uint256(Utils.slice(arr, 288));
        proof.A_C = Utils.G1Point(Utils.slice(arr, 320), Utils.slice(arr, 352));
        proof.A_y = Utils.G1Point(Utils.slice(arr, 384), Utils.slice(arr, 416));
        proof.A_b = Utils.G1Point(Utils.slice(arr, 448), Utils.slice(arr, 480));
        proof.A_X = Utils.G1Point(Utils.slice(arr, 512), Utils.slice(arr, 544));
        proof.A_tau = Utils.G1Point(Utils.slice(arr, 576), Utils.slice(arr, 608));
        proof.c = uint256(Utils.slice(arr, 640));
        proof.s_sk = uint256(Utils.slice(arr, 672));
        proof.s_r = uint256(Utils.slice(arr, 704));
        proof.s_b = uint256(Utils.slice(arr, 736));
        proof.s_tau = uint256(Utils.slice(arr, 768));

        InnerProductVerifier.InnerProductProof memory ipProof;
        ipProof.L = new Utils.G1Point[](6);
        ipProof.R = new Utils.G1Point[](6);
        for (uint256 i = 0; i < 6; i++) {
            ipProof.L[i] = Utils.G1Point(Utils.slice(arr, 800 + i * 64), Utils.slice(arr, 832 + i * 64));
            ipProof.R[i] = Utils.G1Point(Utils.slice(arr, 800 + (6 + i) * 64), Utils.slice(arr, 832 + (6 + i) * 64));
        }
        ipProof.a = uint256(Utils.slice(arr, 800 + 12 * 64));
        ipProof.b = uint256(Utils.slice(arr, 832 + 12 * 64));
        proof.ipProof = ipProof;

        return proof;
    }
}