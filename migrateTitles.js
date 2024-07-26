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

async function migrateTitles() {
  try {
    await client.connect();
    console.log('Connected to Redis successfully!');

    const keys = await client.keys('gpt-response:*');
    for (const key of keys) {
      const subject = key.replace('gpt-response:', '');
      const titleKey = `title:${subject}`;
      const titleExists = await client.exists(titleKey);
      
      if (!titleExists) {
        await client.set(titleKey, subject);
        console.log(`Title for subject "${subject}" set to "${subject}"`);
      } else {
        console.log(`Title for subject "${subject}" already exists`);
      }
    }

    console.log('Migration completed!');
    await client.disconnect();
  } catch (err) {
    console.error('Error during migration:', err);
  }
}

migrateTitles();
