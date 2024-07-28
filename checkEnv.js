require('dotenv').config();

const openaiApiKey = process.env.API_KEY;
const redisHost = process.env.REDIS_HOST;
const redisPort = process.env.REDIS_PORT;
const port = process.env.PORT || 3000;

console.log('Environment Variables:');
console.log(`API_KEY: ${openaiApiKey ? 'Set' : 'Not Set'}`);
console.log(`REDIS_HOST: ${redisHost ? redisHost : 'Not Set'}`);
console.log(`REDIS_PORT: ${redisPort ? redisPort : 'Not Set'}`);
console.log(`PORT: ${port}`);
