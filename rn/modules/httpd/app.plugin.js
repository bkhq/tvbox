// @ts-check
const { withInfoPlist } = require('expo/config-plugins');

const LOCAL_NETWORK_USAGE = '用于手机控制和局域网投屏';
const BONJOUR_SERVICE = '_http._tcp';

/**
 * iOS/tvOS local network privacy: the usage text and the Bonjour service type the
 * httpd module advertises. Existing values from other plugins are kept.
 *
 * @type {import('expo/config-plugins').ConfigPlugin}
 */
const withHttpd = (config) =>
  withInfoPlist(config, (config) => {
    const plist = config.modResults;
    if (typeof plist.NSLocalNetworkUsageDescription !== 'string') {
      plist.NSLocalNetworkUsageDescription = LOCAL_NETWORK_USAGE;
    }
    const services = Array.isArray(plist.NSBonjourServices) ? plist.NSBonjourServices : [];
    if (!services.includes(BONJOUR_SERVICE)) services.push(BONJOUR_SERVICE);
    plist.NSBonjourServices = services;
    return config;
  });

module.exports = withHttpd;
