'use strict';


const querystring = require('querystring');
const url = require('url');

const ChildChain = require('@omisego/omg-js-childchain');
const BigchainDb = require('bigchaindb-driver');
const Web3 = require('web3');


const Chain = require('./chain');
const Scope = require('./scope');


function Transactions(client) {
  this.client = client;
}


Transactions.prototype.resolve = function(chain, transactionId, scope) {
  return new Promise((resolve, reject) => {
    if (!chain) {
      chain = Chain.Ethereum;
    }

    if (!scope) {
      scope = Scope.Root;
    }

    const request = this.client.get('transactions'
      + '/' + chain
      + '/' + transactionId
      + '?' + querystring.stringify({scope: scope}));

    this.client.resolve(request)
      .then(response => {
        if (200 === response.status) {
          resolve(JSON.parse(response.body));
        } else {
          reject(response);
        }
      })
      .catch(reject);
  });
};

Transactions.prototype.resolvePending = function(transactionId) {
  return new Promise((resolve, reject) => {
    const request = this.client.get('transactions/pending/' + transactionId);

    this.client.resolve(request)
      .then(response => {
        if (200 === response.status) {
          resolve(JSON.parse(response.body));
        } else {
          reject(response);
        }
      })
      .catch(reject);
  });
};

Transactions.prototype.sign = function(transaction, keyPair) {
  if (Chain.BigchainDb === transaction.chain) {
    return this.signBigchainDb(transaction, keyPair);
  }

  if (Chain.Ethereum === transaction.chain) {
    return this.signEthereum(transaction, keyPair);
  }

  throw new Error('Failed to sign transaction - unsupported chain [' + transaction.chain + '].');
};

Transactions.prototype.signBigchainDb = function(transaction, keyPair) {
  return new Promise(resolve => {
    resolve({
      chain: transaction.chain,
      scope: transaction.scope,
      value: BigchainDb.Transaction.signTransaction(transaction.value, keyPair.privateKey)
    });
  });
};

Transactions.prototype.signEthereum = function(transaction, keyPair) {
  if (Scope.Child === transaction.scope) {
    return this.signEthereumChild(transaction, keyPair);
  }

  return this.signEthereumRoot(transaction, keyPair);
};

Transactions.prototype.signEthereumChild = function(transaction, keyPair) {
  return new Promise(resolve => {
    const keys = [];

    transaction.value.inputs.forEach(() => {
      keys.push(keyPair.privateKey);
    });

    transaction.value.outputs.forEach(output => {
      output.amount = this.intToHex(output.amount);
    });

    const child = new ChildChain();

    const unsigned = child.createTransaction(transaction.value);
    const signatures = child.signTransaction(unsigned, keys);
    const signed = child.buildSignedTransaction(unsigned, signatures);

    resolve({
      chain: transaction.chain,
      scope: transaction.scope,
      value: {raw: signed}
    });
  });
};

Transactions.prototype.signEthereumRoot = function(transaction, keyPair) {
  return new Promise((resolve, reject) => {
    const web3 = new Web3(this.client.config.web3_provider);

    web3.eth.personal.unlockAccount(keyPair.publicKey, '', 100).then(() => {
      web3.eth.signTransaction(transaction.value, keyPair.privateKey)
      .then(signed => {
        resolve({
          chain: transaction.chain,
          scope: transaction.scope,
          value: signed 
        });
      })
      .catch(reject);
    })
    .catch(reject);
  });
};

Transactions.prototype.commit = function(transactionId, transaction) {
  return new Promise((resolve, reject) => {
    const request = this.client.put('transactions/pending/' + transactionId);
    request.setHeader('Content-Type', 'application/json');

    this.client.resolve(request, {transaction: transaction})
      .then(response => {
        if (201 === response.status) {
          resolve(response.header['x-ares-created-id']);
        } else {
          reject(response);
        }
      })
      .catch(reject);
    });
};

Transactions.prototype.signWithPrivateKeyAndCommit = function(challenge, keyPair) {
  return new Promise((resolve, reject) => {
    this.pending(challenge.transactionId)
      .then(transaction => {
        this.sign(transaction, keyPair.privateKey)
          .then(signed => {
            this.commit(challenge.transactionId, signed)
              .then(transactionId => {
                resolve(transactionId);
              })
              .catch(reject);
          })
          .catch(reject);
      })
      .catch(reject);
  });
};

Transactions.prototype.resolveAuthorizationUrl = function(challenge, callbackUrl) {
  if (!callbackUrl && window && window.location) {
    callbackUrl = window.location.href;
  }

  const parsed = url.parse(challenge.authorizationUrl);

  let query = {};
  if (parsed.query) {
    query = querystring.parse(parsed.query);
  }

  query['redirect_uri'] = callbackUrl;
  parsed.search = '?' + querystring.stringify(query);

  return url.format(parsed);
};

Transactions.prototype.intToHex = function(value) {
  let hex = parseInt(value).toString(16);

  if (hex.length % 2) {
    hex = '0' + hex;
  }

  return '0x' + hex;
}


module.exports = Transactions;
