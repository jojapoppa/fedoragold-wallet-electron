const fs = require('fs');
const path = require('path');
const chdir = require('process').chdir;
const exec = require('child_process').exec;

exports.default = async function (context) {
  console.log(context)
  const isLinux = context.targets.find(target => target.name === 'appImage')
  if (!isLinux) {
    console.log("It's not Linux: No afterPack needed to apply --no-sandbox option");
    return;
  }

  const originalDir = process.cwd();
  const dirname = context.appOutDir;
  chdir(dirname);

  console.log("repacking in folder: "+dirname);
  fs.rename(dirname+'/fedoragoldwallet', dirname+'/fedoragoldwallet.bin', () => {
    const wrapperScript = `#!/bin/bash 
      "\${BASH_SOURCE%/*}"/fedoragoldwallet.bin "$@" --no-sandbox
    `;
    console.log("repack script: "+wrapperScript);
    fs.writeFileSync(dirname+'/fedoragoldwallet', wrapperScript);
    fs.chmod(dirname+'/fedoragoldwallet', 0o770, ()=>{console.log('repacked with --no-sandbox');});
  });

  chdir(originalDir);
}
