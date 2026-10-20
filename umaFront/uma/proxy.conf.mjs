const TARGET = 'https://umaserver.nanax3.xyz';

export default {
  '/g': {
    target: TARGET,
    changeOrigin: true,
    secure: true,
    rewrite: (path) => path.replace(/^\/g/, ''),
  },
};
