import {build} from 'esbuild';
await build({entryPoints:['third-party/air-native-video/guest-js/index.ts'],bundle:true,format:'esm',target:'es2022',outfile:'app/vendor/native-video.js',legalComments:'eof',banner:{js:'// Air native video adapter (MIT OR Apache-2.0). Source and licenses: third-party/air-native-video.'}});
