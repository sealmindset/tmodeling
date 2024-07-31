require('dotenv').config();
const redis = require('redis');
const client = redis.createClient({
  url: `redis://${process.env.REDIS_HOST}:${process.env.REDIS_PORT}`
});

client.on('error', (err) => {
  console.error('Redis error:', err);
});

client.connect()
  .then(() => console.log('Connected to Redis successfully!'))
  .catch(console.error);

const clearSubjectKeys = async () => {
  try {
    const keys = await client.keys('*');
    const subjectKeys = keys.filter(key => key.startsWith('gpt-response:') || key.startsWith('title:') || key.startsWith('model:') || key.startsWith('summary:') || key.startsWith('subject:'));

    console.log(`Found ${subjectKeys.length} keys to delete.`);

    if (subjectKeys.length > 0) {
      await client.del(subjectKeys);
      console.log('All subject-related keys have been deleted.');
    } else {
      console.log('No subject-related keys found.');
    }
  } catch (error) {
    console.error('Error during clearing keys:', error);
  } finally {
    client.quit();
  }
};

clearSubjectKeys();
