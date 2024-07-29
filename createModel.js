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

async function migrateModels() {
  try {
    await client.connect();
    console.log('Connected to Redis successfully!');

    const keys = await client.keys('gpt-response:*');
    for (const key of keys) {
      const subject = key.replace('gpt-response:', '');
      
      // Set model key
      const modelKey = `model:${subject}`;
      const modelExists = await client.exists(modelKey);
      
      if (!modelExists) {
        await client.set(modelKey, ''); // Setting an empty model
        console.log(`Model for subject "${subject}" initialized to an empty string`);
      } else {
        console.log(`Model for subject "${subject}" already exists`);
      }
    }

    console.log('Migration completed!');
    await client.disconnect();
  } catch (err) {
    console.error('Error during migration:', err);
  }
}

migrateModels();
