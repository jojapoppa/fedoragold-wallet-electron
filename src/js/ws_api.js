const request = require('request-promise-native');
const config = require('./ws_config.js');
const log = require('electron-log');
const http = require('http');

class WalletShellApi {
    constructor(args) {
        args = args || {};
        if (!(this instanceof WalletShellApi)) return new WalletShellApi(args);
        this.daemon_host = args.daemon_host || '127.0.0.1';
        this.daemon_port = args.daemon_port;
        this.walletd_host = args.walletd_host || '127.0.0.1';
        this.walletd_port = args.walletd_port || config.walletServiceRpcPort;
        this.walletd_password = args.walletd_password || "WHATEVER1234567891";
        this.minimum_fee = (args.minimum_fee !== undefined) ? args.minimum_fee : 
          (config.minimumFee*config.decimalDivisor);
        this.anonimity = config.defaultMixin;
        this.daemonCoreReady = args.daemonCoreReady || false;
    }

    _sendRequest(method, todaemon, params, timeout) {
        return new Promise((resolve, reject) => {
            if (method.length === 0) return reject(new Error('Invalid Method'));
            params = params || {};
            timeout = timeout || 10000;
            let data = {
                jsonrpc: '2.0',
                method: method,
                params: params,
                password: this.walletd_password
            };

            // needed to support certain systems that have very poor network latency
            var myAgent = new http.Agent({
                keepAlive: true,
                keepAliveMsecs: 10000
            });

            let headers = {
                Connection: 'Keep-Alive',
                Agent: myAgent
            };

            let s_uri = `http://${this.walletd_host}:${this.walletd_port}/json_rpc`;
            let s_method = 'POST';

            if (todaemon) {
                s_uri = `http://${this.daemon_host}:${this.daemon_port}/${method}`;
                s_method = 'GET';
                headers = {Connection: 'Keep-Alive', Agent: myAgent};
                data = {
                  jsonrpc: '2.0'
                };
            }

            request({
                uri: s_uri,
                method: s_method,
                headers: headers,
                body: data,
                json: true,
                timeout: timeout
            }).on('socket', function(socket){
                socket.setTimeout(9000);
            }).on('error', function(e) {
                // just eat the error, don't throw or stop
                // log.warn('error on socket: ', e);
            }).then((res) => {
                if (!res) return resolve(true);
                if (!res.error) {
                    if (res.result) return resolve(res.result);
                    return resolve(res);
                } else {
                    return reject(res.error.message);
                }
            }).catch((err) => {
                return reject(err);
            });
	});
    }
    // used to switch wallet to local daemon once it is fully synced
    bindDaemon(daemonIP, daemonPort) {
        return new Promise((resolve, reject) => {
            if (daemonPort > 0) {
                let req_params = {
                    daemonIP: daemonIP,
                    daemonPort: daemonPort
                };
                this._sendRequest('bindDaemon', false, req_params, 5000).then((result) => {
                    return resolve(result);
                }).catch((err) => {
                    return reject(err);
                });
            }
        });
    }
    // used to determine state of sync for daemon fullnode
    getHeight() {
        return new Promise((resolve, reject) => {
            this._sendRequest('getheight', true).then((result) => {
                return resolve(result);
            }).catch((err) => {
                return reject(err);
            });
        });
    }
    // only get single addres only, no multi address support for this wallet, yet
    getAddress() {
        return new Promise((resolve, reject) => {
            this._sendRequest('getAddresses', false).then((result) => {
                return resolve(result.addresses[0]);
            }).catch((err) => {
                return reject(err);
            });
        });
    }
    getFeeInfo() {
        return new Promise((resolve, reject) => {
            this._sendRequest('getFeeInfo', false).then((result) => {
                return resolve(result);
            }).catch((err) => {
                return reject(err);
            });
        });
    }
    getBalance(params) {
        return new Promise((resolve, reject) => {
            params = params || {};
            params.address = params.address || '';
            let req_params = {
                address: params.address
            };
            this._sendRequest('getBalance', false, req_params, 5000).then((result) => {
                return resolve(result);
            }).catch((err) => {
                return reject(err);
            });
        });
    }
    getStatus() {
        return new Promise((resolve, reject) => {
            this._sendRequest('getStatus', false).then((result) => {
                return resolve(result);
            }).catch((err) => {
                return reject(err);
            });
        });
    }
    getInfo() {
        //let req_params = {};
        return new Promise((resolve, reject) => {
            this._sendRequest('getinfo', true).then((result) => {
                return resolve(result);
            }).catch((err) => {
                // Just eat any errors...
                //return reject(err);
            });
        });
    }
    save() {
        return new Promise((resolve, reject) => {
            this._sendRequest('save', false, {}, 20000).then(() => {
                return resolve();
            }).catch((err) => {
                return reject(err);
           });
        });
    }
    getViewKey() {
        return new Promise((resolve, reject) => {
            this._sendRequest('getViewKey', false).then((result) => {
                return resolve(result);
            }).catch((err) => {
                return reject(err);
            });
        });
    }
    getSpendKeys(params) {
        return new Promise((resolve, reject) => {
            params = params || {};
            params.address = params.address || '';
            if (!params.address.length)
                return reject(new Error('Missing address parameter'));
            var req_params = {
                address: params.address
            };
            this._sendRequest('getSpendKeys', false, req_params).then((result) => {
                return resolve(result);
            }).catch((err) => {
                return reject(err);
            });
        });
    }
    getMnemonicSeed(params) {
        return new Promise((resolve, reject) => {
            params = params || {};
            params.address = params.address || '';
            if (params.address.length === 0)
                return reject(new Error('Missing address parameter'));
            var req_params = {
                address: params.address
            };
            this._sendRequest('getMnemonicSeed', false, req_params).then((result) => {
                return resolve(result);
            }).catch((err) => {
                return reject(err);
            });
        });
    }
    getBackupKeys(params) {
        return new Promise((resolve, reject) => {
            var backupKeys = {};
            params = params || {};
            params.address = params.address || '';
            if (params.address.length === 0) return reject(new Error('Missing address parameter'));
            var req_params = {
                address: params.address
            };

            this.getViewKey().then((vkres) => {
                backupKeys.viewSecretKey = vkres.viewSecretKey;
                return vkres;
            }).then((vsres) => {
                return this.getSpendKeys(req_params).then((vsres) => {
                      backupKeys.spendSecretKey = vsres.spendSecretKey;
                      return vsres;
                }).catch((err) => { return reject(err); });
            }).then(() => {
                //confirm(`viewSecretKey: ${backupKeys.viewSecretKey}`);
                //confirm(`spendSecretKey: ${backupKeys.spendSecretKey}`);
                return resolve(backupKeys);
            }).catch((err) => { return reject(err); });
        
            // this.getMnemonicSeed(req_params).then((mres) => {
            // backupKeys.mnemonicSeed = mres.mnemonicSeed;
        });
    }
    getTransactions(params) {
        return new Promise((resolve, reject) => {
            params = params || {};
            params.firstBlockIndex = params.firstBlockIndex || 1;
            params.blockCount = params.blockCount || 100;
            var req_params = {
                firstBlockIndex: (params.firstBlockIndex >= 1) ? params.firstBlockIndex : 1,
                blockCount: (params.blockCount >= 1) ? params.blockCount : 100
            };
            this._sendRequest('getTransactions', false, req_params, 20000).then((result) => {
                return resolve(result);
            }).catch((err) => {
                return reject(err);
            });
        });
    }
    // send single transaction
    sendTransaction(params) {
        return new Promise((resolve, reject) => {
            params = params || {};
            params.amount = params.amount || false;
            params.address = params.address || false;
            //params.transfers = params.transfers || false;
            params.paymentId = params.paymentId || false;
            params.fee = params.fee || this.minimum_fee;
            if (!params.address) return reject(new Error('Missing recipient address parameter'));
            if (!params.amount) return reject(new Error('Missing transaction amount parameter'));
            if (parseFloat(params.fee) < 0.1) return reject(new Error('Minimum fee is 0.1 FED'));
            //[{address: "FEDxxxx...", amount: 100}];
            //jojapoppa added anonymity(mixin) and unlockTime below	
            var req_params = {
                transfers: [{ address: params.address, amount: params.amount }],
                anonymity: 0, 
                unlockTime: 0,
                fee: params.fee
            };
            if (params.paymentId) req_params.paymentId = params.paymentId;
            // give extra long timeout
            this._sendRequest('sendTransaction', false, req_params, 20000).then((result) => {
                return resolve(result);
            }).catch((err) => {
                return reject(err);
            });
        });
    }
    reset(params) {
        return new Promise((resolve, reject) => {
            params = params || {};
            let req_params = {};

            // server does not expect a scanHeight at the moment...
            //params.scanHeight = params.scanHeight || 0;
            //if (params.scanHeight && params.scanHeight > 1) {
            //    req_params = { scanHeight: params.scanHeight };
            //}

            params.viewSecretKey = params.viewSecretKey || false;
            if (params.viewSecretKey) {
              log.warn("reset: secret key supplied... creating new wallet from secret key");
              req_params.viewSecretKey = params.viewSecretKey;
            }

            this._sendRequest('reset', false, req_params).then(() => {
              log.warn("sent api reset to walletd...");
              return resolve(true);
            }).catch((err) => {
              return reject(err);
            });
        }).catch((err) => { /* just eat it... connection timeouts are common here */ });
    }
    estimateFusion(params) {
        return new Promise((resolve, reject) => {
            params = params || {};
            if (!params.threshold) return reject(new Error('Missing threshold parameter'));
            this._sendRequest('estimateFusion', false, params).then((result) => {
                return resolve(result);
            }).catch((err) => {
                return reject(err);
            });
        });
    }
    sendFusionTransaction(params) {
        return new Promise((resolve, reject) => {
            params = params || {};
            if (!params.threshold) return reject(new Error('Missing threshold parameter'));
            if (!params.anonimity) params.anonimity = this.anonimity;
            this._sendRequest('sendFusionTransaction', false, params).then((result) => {
                return resolve(result);
            }).catch((err) => {
                return reject(err);
            });
        });
    }
    createIntegratedAddress(params) {
        return new Promise((resolve, reject) => {
            params = params || {};
            if (!params.address || !params.paymentId) {
                return reject(new Error('Address and Payment Id parameters are required'));
            }
            
            this._sendRequest('createIntegratedAddress', false, params).then((result) => {
                return resolve(result);
            }).catch((err) => {
                return reject(err);
            });
        });
    }
}

module.exports = WalletShellApi;
