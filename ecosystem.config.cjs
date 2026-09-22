module.exports = {
  apps: [
    {
      name: 'meta-ai-bridge',
      cwd: './meta-ai-bridge',
      script: './wametaai.exe',
      autorestart: true,
      max_restarts: 10,
      restart_delay: 4000,
      watch: false
    },
    {
      name: 'bot-evv',
      cwd: './',
      script: 'node',
      args: 'dist/index.js',
      autorestart: true,
      max_restarts: 10,
      restart_delay: 4000,
      watch: false,
      env: {
        NODE_ENV: 'production'
      }
    }
  ]
};
