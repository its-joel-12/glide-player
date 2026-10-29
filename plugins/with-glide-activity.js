// Lets the main activity go into picture-in-picture and survive rotation / PiP resizes
// without restarting. Applied on `expo prebuild` (android/ is generated, never edited by hand).
const { AndroidConfig, withAndroidManifest } = require('expo/config-plugins');

const CONFIG_CHANGES = [
  'keyboard',
  'keyboardHidden',
  'orientation',
  'screenLayout',
  'screenSize',
  'smallestScreenSize',
  'uiMode',
];

module.exports = function withGlideActivity(config) {
  return withAndroidManifest(config, (c) => {
    const activity = AndroidConfig.Manifest.getMainActivityOrThrow(c.modResults);
    activity.$['android:supportsPictureInPicture'] = 'true';
    activity.$['android:resizeableActivity'] = 'true';
    const existing = (activity.$['android:configChanges'] || '').split('|').filter(Boolean);
    activity.$['android:configChanges'] = [...new Set([...existing, ...CONFIG_CHANGES])].join('|');
    return c;
  });
};
