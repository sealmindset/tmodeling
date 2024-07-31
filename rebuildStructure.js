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

const getNextSubjectId = async () => {
  const idKey = 'subject_id_counter';
  const subjectId = await client.incr(idKey);
  return subjectId;
};

const rebuildStructure = async () => {
  try {
    // Your logic to fetch subjects and their details from your data source
    const subjects = [
      { subject: 'Sample Subject 1', response: 'Sample Response 1', title: 'Sample Title 1', model: 'gpt-4o', summary: 'Sample Summary 1' },
      { subject: 'Sample Subject 2', response: 'Sample Response 2', title: 'Sample Title 2', model: 'gpt-4o', summary: 'Sample Summary 2' },
      // Add more subjects as needed
    ];

    for (let subjectObj of subjects) {
      const { subject, response, title, model, summary } = subjectObj;

      // Generate a new SUBJECT_ID
      const subjectId = await getNextSubjectId();

      // Store the data with the new SUBJECT_ID
      await client.set(`gpt-response:${subjectId}`, response);
      await client.set(`title:${subjectId}`, title);
      await client.set(`model:${subjectId}`, model);
      await client.set(`summary:${subjectId}`, summary);
      await client.set(`subject:${subjectId}`, subject);

      console.log(`Added subject "${subject}" with subject ID ${subjectId}`);
    }

    console.log('Rebuilding completed successfully!');
  } catch (error) {
    console.error('Error during rebuilding:', error);
  } finally {
    client.quit();
  }
};

rebuildStructure();
