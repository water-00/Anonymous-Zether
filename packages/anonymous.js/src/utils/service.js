const ZetherProof = require('../prover/zether.js');
const BurnProof = require('../prover/burn.js');

class Service {
    static proveTransfer(Cn, C, C0_prime, y, epoch, sk, r, values, bTransfer, bDiff, fee) {
        const statement = {}; // 转账发起者的陈述dict
        statement['Cn'] = Cn;
        statement['C'] = C;
        statement['C0_prime'] = C0_prime;
        statement['y'] = y;
        statement['epoch'] = epoch;

        const witness = {}; // 服务器的验证dict, 秘密数据, 只有服务器能看
        witness['sk'] = sk;
        witness['r'] = r;
        witness['values'] = values;
        witness['bTransfer'] = bTransfer;
        witness['bDiff'] = bDiff;

        return ZetherProof.prove(statement, witness, fee);
    };

    static proveBurn(Cn, y, epoch, sender, sk, bDiff) {
        const statement = {};
        statement['Cn'] = Cn;
        statement['y'] = y;
        statement['epoch'] = epoch;
        statement['sender'] = sender;

        const witness = {};
        witness['sk'] = sk;
        witness['bDiff'] = bDiff;

        return BurnProof.prove(statement, witness);
    }
}

module.exports = Service;