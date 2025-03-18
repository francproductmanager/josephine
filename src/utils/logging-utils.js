// utils/logging-utils.js
function logDetails(message, obj = null) {
  console.log(`[${new Date().toISOString()}] ${message}`);
  if (obj) {
    console.log(JSON.stringify(obj, null, 2));
  }
}

module.exports = {
  logDetails
};
