import { defineConfig } from 'wxt';

/**
 * Public half of the dev signing key. Pins the unpacked extension ID to
 * `jojhniohldijhpnpeihdnffjflgcpnpb` so the Entra dev redirect URI
 * (https://jojhniohldijhpnpeihdnffjflgcpnpb.chromiumapp.org/) stays stable.
 * Dev builds only: Chrome Web Store and Edge Add-ons assign their own IDs.
 */
const DEV_MANIFEST_KEY =
  'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA9BJCWm9Fr1shy6+XCxG856YII9QUV3awWMgGAiiDc/r2Uh/gSqWlELvsM3HGhh3pI2oteZ0HsheB2036EW/XzYY3kLTJ656pM0JoGVAxCv3yDpA9ALtmZOfQm3PBF8bfNapwf7l9k+qMvo4FVCaAo4Wmilxk9Qk61FsNMraOU/vUyi2Cm36McTUOaraI7288Y7GBjdM5m7wV8TxkVh5xj1WzwvshSUEJElec+J9D5QDwoWWssY8WJ04+Gafk2aix9WWh0HEL1wmFgyp5S77gHt9I3vWbOv/KqunOXrt0t1600JQor6eFc6ZB3qO9cfslWjfVHKxy2A4MZjsnB92TTwIDAQAB';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: ({ mode }) => ({
    name: 'azinfo',
    description:
      'Azure cost info next to the resource you are viewing in the Azure portal. Not affiliated with Microsoft.',
    permissions: ['identity', 'storage'],
    host_permissions: [
      'https://portal.azure.com/*',
      'https://management.azure.com/*',
      'https://login.microsoftonline.com/*',
    ],
    ...(mode === 'development' ? { key: DEV_MANIFEST_KEY } : {}),
  }),
});
