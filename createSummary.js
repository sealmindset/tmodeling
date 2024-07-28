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

async function migrateSummaries() {
  try {
    await client.connect();
    console.log('Connected to Redis successfully!');

    const keys = await client.keys('gpt-response:*');
    for (const key of keys) {
      const subject = key.replace('gpt-response:', '');
      
      // Set summary key
      const summaryKey = `summary:${subject}`;
      const summaryExists = await client.exists(summaryKey);
      
      if (!summaryExists) {
        await client.set(summaryKey, ''); // Setting an empty summary
        console.log(`Summary for subject "${subject}" initialized to an empty string`);
      } else {
        console.log(`Summary for subject "${subject}" already exists`);
      }
    }

    console.log('Migration completed!');
    await client.disconnect();
  } catch (err) {
    console.error('Error during migration:', err);
  }
}

migrateSummaries();
