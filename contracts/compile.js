const fs = require('fs');
const path = require('path');
const solc = require('solc');

function compileContract() {
  const contractPath = path.join(__dirname, 'VeriQuantSessionVault.sol');
  const source = fs.readFileSync(contractPath, 'utf8');

  const input = {
    language: 'Solidity',
    sources: {
      'VeriQuantSessionVault.sol': {
        content: source
      }
    },
    settings: {
      optimizer: {
        enabled: true,
        runs: 200
      },
      outputSelection: {
        '*': {
          '*': ['abi', 'evm.bytecode', 'evm.deployedBytecode']
        }
      }
    }
  };

  console.log('Compiling VeriQuantSessionVault.sol with Solidity 0.8.24...');
  const output = JSON.parse(solc.compile(JSON.stringify(input)));

  if (output.errors && output.errors.length > 0) {
    let hasError = false;
    for (const error of output.errors) {
      console.log(`[${error.severity.toUpperCase()}] ${error.formattedMessage}`);
      if (error.severity === 'error') hasError = true;
    }
    if (hasError) {
      throw new Error('Solidity compilation failed.');
    }
  }

  const contract = output.contracts['VeriQuantSessionVault.sol']['VeriQuantSessionVault'];
  const artifact = {
    contractName: 'VeriQuantSessionVault',
    abi: contract.abi,
    bytecode: '0x' + contract.evm.bytecode.object,
    deployedBytecode: '0x' + contract.evm.deployedBytecode.object,
    compiler: '0.8.24+commit.e11b9ed9',
    compiledAt: new Date().toISOString()
  };

  const outputPath = path.join(__dirname, 'VeriQuantSessionVault.json');
  fs.writeFileSync(outputPath, JSON.stringify(artifact, null, 2), 'utf8');

  console.log(`Compilation successful! Artifact saved to: ${outputPath}`);
  console.log(`Bytecode size: ${artifact.bytecode.length / 2 - 1} bytes`);
  return artifact;
}

if (require.main === module) {
  compileContract();
}

module.exports = { compileContract };
