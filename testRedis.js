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

client.connect()
  .then(() => console.log('Connected to Redis successfully!'))
  .catch(console.error);

const checkSubject = async (subject) => {
  const cacheKey = `gpt-response:${subject}`;
  try {
    const response = await client.get(cacheKey);
    if (response) {
      console.log(`The subject "${subject}" is populated:`, response);
    } else {
      console.log(`The subject "${subject}" is not populated or does not exist.`);
    }
  } catch (error) {
    console.error('Error fetching response from Redis:', error);
  } finally {
    await client.disconnect();
  }
};

// Replace 'YOUR_SUBJECT_HERE' with the actual subject you want to check
const subjectToCheck = 'YOUR_SUBJECT_HERE';
checkSubject(subjectToCheck);
