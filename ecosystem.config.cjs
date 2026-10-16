// pm2 app definition. Run `pnpm build` first: pm2 runs the compiled CLI.
module.exports = {
  apps: [
    {
      name: 'paperplane',
      script: 'dist/cli.js',
      args: 'start',
      cwd: __dirname,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      // A start that dies within 10s (held lock, bad config) counts against max_restarts.
      min_uptime: '10s',
      // Time for mtcute to close its storage cleanly; an unclean close makes
      // catchUp replay duplicate updates on the next start.
      kill_timeout: 10000,
      env: { NODE_ENV: 'production' },
    },
  ],
};
