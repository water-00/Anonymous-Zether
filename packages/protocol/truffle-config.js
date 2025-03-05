module.exports = {
    networks: {
        development: {
            host: "127.0.0.1",
            port: 8545, // ganache
            gasPrice: 0,
            network_id: "*", // Match any network id
            // gas: 30000000,
            websockets: true,
        },
        // 原开发网络（供 Remix 使用）
        // development: {
        //     host: "127.0.0.1",
        //     port: 8545, // Remix 专用端口
        //     gasPrice: 0,
        //     network_id: "*",
        //     websockets: true,
        // },
        // // 新增测试专用网络
        // test: {
        //     host: "127.0.0.1",
        //     port: 8546, // 新端口
        //     gasPrice: 0,
        //     network_id: "*",
        //     websockets: true,
        // },
        qex: {
            host: "127.0.0.1",
            port: 22000, // node1 in quorum examples
            gasPrice: 0,
            network_id: "*",
            websockets: true,
        }
    },
    compilers: {
        solc: {
            version: "0.7.0",
        }
    }
};
