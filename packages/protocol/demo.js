// demo.js
const Web3 = require('web3');
const path = require('path');
const contract = require('@truffle/contract');

async function main() {
try {
  // 初始化 Web3
  const web3 = new Web3('http://localhost:8545');
  const provider = new Web3.providers.WebsocketProvider('ws://localhost:8545');
  web3.setProvider(provider);

  // 加载合约
  // 在/contracts目录下有7个solidity文件, 但是/build/contracts下有12个文件, 那些多出来的文件是哪来的?
  // Truffle项目编译出来的JSON文件有
  // 1. 用户写的7个.sol
  // 2. .sol文件中引用的第三方库, 主要是OpenZeppelin (一个Solidity模板库) 中的库: ERC20, IERC20, SafeMath, Context, Address
  const loadContract = async (contractName) => {
    const contractJson = require(path.join(process.cwd(), `build/contracts/${contractName}.json`));
    const c = contract(contractJson);
    c.setProvider(provider);
    return c.deployed();
  };

  // 加载Client模块
  const Client = require(path.join(process.cwd(), '../anonymous.js/src/client.js'));

  // 获取合约实例
  const zsc = await loadContract('ZSC');
  const cash = await loadContract('CashToken');
  
  // 获取账户
  const accounts = await web3.eth.getAccounts();
  const home = accounts[accounts.length - 1];

  // console.log("Available accounts:", accounts); // 打印所有账户

  // 初始化代币
  console.log('\n1. 初始化代币...');
  const initialAmount = 1000; // 直接使用基本单位
  await cash.mint(home, initialAmount, { from: home });
  await cash.approve(zsc.address, initialAmount, { from: home });
  console.log('当前ERC20余额:', (await cash.balanceOf(home)).toString());

  // 创建客户端实例
  console.log('\n2. 创建用户客户端...');
  const alice = new Client(web3, zsc.contract, home);
  const bob = new Client(web3, zsc.contract, accounts[1]);

  // 注册账户
  console.log('\n3. 注册账户...');
  await alice.register();
  await bob.register();

  console.log('\n3.1 初始化匿名参与者...');
  const carol = new Client(web3, zsc.contract, accounts[2]);
  const dave = new Client(web3, zsc.contract, accounts[3]);
  await carol.register();
  await dave.register();

  // 存款操作
  console.log('\n4. Alice存款...');
  await alice.deposit(100);
  // await bob.deposit(50);
  // console.log('存款Gas消耗:', depositResult.receipt.gasUsed);

  // 取款操作
  console.log('\n5. Alice取款...');
  await alice.withdraw(10);

  // 添加朋友
  console.log('\n6. 添加朋友...');
  const bobPubKey = await bob.account.public();
  await alice.friends.add("Bob", bobPubKey);
  const alicePubKey = await alice.account.public();
  await bob.friends.add("Alice", alicePubKey);
  const carolPubKey = await carol.account.public();
  await alice.friends.add("Carol", carolPubKey);
  const davePubKey = await dave.account.public();
  await alice.friends.add("Dave", davePubKey);


  // 匿名转账示例（包含Carol和Dave）
  console.log('\n7. Alice向Bob匿名转账...');
  let receipt = await alice.transfer("Bob", 5, ["Carol", "Dave"]);
  console.log("Gas Used: ", receipt.gasUsed);
  await new Promise(resolve => setTimeout(resolve, 200)); // 等待
  assert.equal(
    bob.account.balance(),
    5,
    "Transfer failed"
  );
  console.log('Alice余额:', (await alice.account.balance()).toString());
  console.log('Bob余额:', (await bob.account.balance()).toString());

  // 转账操作
  console.log('\n8. Alice向Bob转账...');
  receipt = await alice.transfer("Bob", 20);
  console.log("Gas Used: ", receipt.gasUsed);
  await new Promise(resolve => setTimeout(resolve, 200)); // 等待
  console.log('Alice余额:', (await alice.account.balance()).toString());
  console.log('Bob余额:', (await bob.account.balance()).toString());

  // // 查询最终余额
  console.log('\n9. 最终余额查询:');
  console.log('Alice余额:', (await alice.account.balance()).toString());
  console.log('Bob余额:', (await bob.account.balance()).toString());
} catch (error) {
    console.error('执行出错:', error);
    // 强制显示最终余额
    console.log('\n[错误发生后强制查询余额]');
    console.log('Alice余额:', (await alice.account.balance()).toString());
    console.log('Bob余额:', (await bob.account.balance()).toString());
    throw error;  
}

}

main().catch(console.error);

// 命令行 在packages/protocol目录下运行 (记得先运行ganache-cli --gasPrice 0 -k berlin 启动本地eth网络):
// truffle migrate
// truffle console
// truffle(development)> .load demo.js

