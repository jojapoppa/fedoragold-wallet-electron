var config = {};

// self explanatory, your application name, descriptions, etc
config.appName = 'FedoraGoldWallet';
config.appDescription = 'FedoraGold (FED) Wallet';
config.appSlogan = 'Welcome to The FED.';
config.appId = 'fed.fedoragold.walletshell';
config.appGitRepo = 'https://github.com/jojapoppa/fedoragold-wallet-electron';

// default port number for your daemon (e.g. fedoragold_daemon)
config.daemonDefaultRpcPort = 31875;

// wallet file created by this app will have this extension
config.walletFileDefaultExt = 'wal';

// change this to match your wallet service executable filename
config.walletServiceBinaryFilename = 'fedoragold_walletd';
config.daemonBinaryFilename = 'fedoragold_daemon';

// version on the bundled service (fedoragold_walletd)
config.walletServiceBinaryVersion = "v0.10.0";

// default port number for your wallet service (e.g. fedoragold_walletd)
config.walletServiceRpcPort = 31876;

// block explorer url, the [[TX_HASH] will be substituted w/ actual transaction hash
config.blockExplorerUrl = 'http://explorer.fedoragold.com/gettransaction.php?hash=[[TX_HASH]]';

// default remote node to connect to, set this to a known reliable node for 'just works' user experience
config.remoteNodeDefaultHost = '127.0.0.1'; // then fallback to seed1 etc...

// remote node list update url, set to null if you don't have one
config.remoteNodeListUpdateUrl = null; 
// this remoteNodeList is set using nodes.hashvault.pro in the newer version...
//'https://raw.githubusercontent.com/mycoin/mycoin-nodes-json/master/mycoin-nodes.json';

// fallback remote node list, in case fetching update failed, fill this with known to works remote nodes
config.remoteNodeListFallback = [
    '18.223.178.174:30158', // seed1
    '18.222.96.134:30158'   // seed2
];

// your currency name
config.assetName = 'FedoraGold';
// your currency ticker
config.assetTicker =  'FED';
// your currency address prefix, for address validation
config.addressPrefix =  '';  // jojapoppa, should FED assume a prefix of "N"? if i add that does it chance the validatAddress() lengths?
// standard wallet address length, for address validation
config.addressLength = 95;
// integrated wallet address length, for address validation
config.integratedAddressLength = 187;  //jojapoppa, what is this?

// minimum fee for sending transaction
config.minimumFee = 0.1;
// minimum amount for sending transaction
config.mininumSend = 0.11;
// default mixin/anonimity for transaction
config.defaultMixin = 0; //jojapoppa, trying lower value as it's faster - add to UI for optional setting
// to convert from atomic unit
config.decimalDivisor = 100000000;
// to represent human readable value
config.decimalPlaces = 8;

// obfuscate address book entries, set to false if you want to save it in plain json file.
// not for security because the encryption key is attached here
config.addressBookObfuscateEntries = true;
// key use to obfuscate address book contents
config.addressBookObfuscationKey = '79009fb00ca1b7130832a42de45142cf6c4b7f333fe6fba5';
// initial/sample entries to fill new address book
config.addressBookSampleEntries = [ { } ];

module.exports = config;
