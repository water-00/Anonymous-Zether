const CashToken = artifacts.require("CashToken");
const ZSC = artifacts.require("ZSC");
const Client = require('../../anonymous.js/src/client.js');

contract("ZSC", async (accounts) => {
    let alice; // will reuse...
    let bob;
    let carol;
    let dave;
    let bob1;
    let carol1;
    let dave1;
    let miner;
    let miner1;

    it("should allow minting and approving", async () => {
        const cash = await CashToken.deployed();
        const zsc = await ZSC.deployed();
        await cash.mint(accounts[0], 1000);
        await cash.approve(zsc.contract._address, 1000);
        const balance = await cash.balanceOf.call(accounts[0]);
        assert.equal(balance, 1000, "Minting failed");
    });

    it("should allow initialization", async () => {
        const zsc = await ZSC.deployed();
        alice = new Client(web3, zsc.contract, accounts[0]);
        zuza = new Client(web3, zsc.contract, accounts[0]);
        bob = new Client(web3, zsc.contract, accounts[0]);
        carol = new Client(web3, zsc.contract, accounts[0]);
        dave = new Client(web3, zsc.contract, accounts[0]);
        miner = new Client(web3, zsc.contract, accounts[0]);
        bob1 = new Client(web3, zsc.contract, accounts[0]);
        carol1 = new Client(web3, zsc.contract, accounts[0]);
        dave1 = new Client(web3, zsc.contract, accounts[0]);
        miner1 = new Client(web3, zsc.contract, accounts[0]);
        await Promise.all([alice.register("Alice"), zuza.register("Zuza"), bob.register("Bob"), carol.register("Carol"), dave.register("Dave"), 
            miner.register("Miner"), bob1.register("Bob1"), carol1.register("Carol1"), dave1.register("Dave1"), miner1.register("Miner1")]);

        alice.friends.add("Zuza", zuza.account.public());
        alice.friends.add("Bob", bob.account.public());
        alice.friends.add("Carol", carol.account.public());
        alice.friends.add("Dave", dave.account.public());
        alice.friends.add("Miner", miner.account.public());
        alice.friends.add("Bob1", bob1.account.public());
        alice.friends.add("Carol1", carol1.account.public());
        alice.friends.add("Dave1", dave1.account.public());
        alice.friends.add("Miner1", miner1.account.public());
    });

    it("should allow Alice funding", async () => {
        await alice.deposit(200);
    });

    // it("should allow transferring to 1 people", async () => {
    //     const receipt = await alice.transfer(["Zuza"], [30]);
    //     await new Promise((resolve) => setTimeout(resolve, 100));
    //     assert.equal(zuza.account.balance(), 30, "Transfer failed");

    //     console.log("Gas Used: ", receipt.gasUsed);
    // });

    // it("should allow transferring to 3 people", async () => {
    //     const receipt = await alice.transfer(["Bob", "Carol", "Dave"], [10, 15, 20]);
    //     await new Promise((resolve) => setTimeout(resolve, 100));
    //     assert.equal(bob.account.balance(), 10, "Transfer failed");
    //     assert.equal(carol.account.balance(), 15, "Transfer failed");
    //     assert.equal(dave.account.balance(), 20, "Transfer failed");

    //     console.log("Gas Used: ", receipt.gasUsed);
    // });


    it("should allow transferring to 7 people and miner)", async () => {
        const zsc = await ZSC.deployed();
        const receipt = await alice.transfer(["Zuza", "Bob", "Carol", "Dave", "Bob1", "Carol1", "Dave1"], [10, 10, 10, 10, 10, 10, 10], "Miner");
        await new Promise((resolve) => setTimeout(resolve, 100));
        // assert.equal(bob.account.balance(), 20, "Transfer failed");
        const fee = await zsc.fee.call();
        assert.equal(miner1.account.balance(), fee, "Fees failed");

        console.log("Gas Used: ", receipt.gasUsed);
    });


    // it("should allow Zuza transferring", async () => {
    //     zuza.friends.add("Alice", alice.account.public());
    //     const receipt = await zuza.transfer(["Alice"], [10]);
    //     await new Promise((resolve) => setTimeout(resolve, 100));
    //     assert.equal(zuza.account.balance(), 30, "Transfer failed");

    //     console.log("Gas Used: ", receipt.gasUsed);
    // });

    // it("should allow Zuza withdrawing", async () => {
    //     const receipt = await zuza.withdraw(10);
    //     console.log("Gas Used: ", receipt.gasUsed);
    // });

    // // it("should allow transferring without decoys but with miner", async () => {
    // //     const receipt = await alice.transfer("Bob", 5, [], "Miner");
    // //     await new Promise((resolve) => setTimeout(resolve, 100));
    // //     assert.equal(
    // //         bob.account.balance(),
    // //         35,
    // //         "Transfer failed"
    // //     );

    // //     console.log("Gas Used: ", receipt.gasUsed);
    // // });

    // it("should allow Alice withdrawing again", async () => {
    //     const receipt = await alice.withdraw(5);
    //     console.log("Gas Used: ", receipt.gasUsed);
    // });

    
    // it("should allow Bob withdrawing", async () => {
    //     const receipt = await bob.withdraw(9);
    //     console.log("Gas Used: ", receipt.gasUsed);
    // });

});

// 在packages/protocol目录下运行 (记得先运行ganache-cli --gasPrice 0 -k berlin 启动本地eth网络):
// truffle test