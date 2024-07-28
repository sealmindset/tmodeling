require('dotenv').config();
const redis = require('redis');

const redisHost = process.env.REDIS_HOST || 'localhost';
const redisPort = process.env.REDIS_PORT || 6379;

const client = redis.createClient({
  url: `redis://${redisHost}:${redisPort}`
});

client.on('error', (err) => {
  console.error('Redis error: ', err);
});

async function clearSummaries() {
  try {
    await client.connect();
    console.log('Connected to Redis successfully!');

    const keys = await client.keys('summary:*');
    for (const key of keys) {
      await client.del(key);
      console.log(`Summary key "${key}" has been deleted`);
    }

    console.log('Summary keys cleared!');
    await client.disconnect();
  } catch (err) {
    console.error('Error during clearing summaries:', err);
  }
}

clearSummaries();
