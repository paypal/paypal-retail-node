// Print out the token for a custom environment
// Call with:
//  node custom.js <clientid> <secret> <environment_names_with_comma>

var envs = [];
var names = process.argv[4].split(',');

for (var i = 0; i < names.length; i++) {
  envs.push({
    name: names[i],
    clientId: process.argv[2],
    secret: process.argv[3]
  });
}

console.log(new Buffer(JSON.stringify(envs)).toString('base64'));
