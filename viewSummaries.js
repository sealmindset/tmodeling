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

async function viewSummaries() {
  try {
    await client.connect();
    console.log('Connected to Redis successfully!');

    const keys = await client.keys('summary:*');
    for (const key of keys) {
      const subject = key.replace('summary:', '');
      const summary = await client.get(key);
      console.log(`Subject: "${subject}", Summary: "${summary}"`);
    }

    await client.disconnect();
    console.log('Viewing summaries completed!');
  } catch (err) {
    console.error('Error during viewing summaries:', err);
  }
}

viewSummaries();
