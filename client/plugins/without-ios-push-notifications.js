const { withEntitlementsPlist } = require('expo/config-plugins');

module.exports = function withoutIosPushNotifications(config) {
  return withEntitlementsPlist(config, config => {
    delete config.modResults['aps-environment'];
    return config;
  });
};
