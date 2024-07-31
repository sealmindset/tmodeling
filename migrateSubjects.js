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

const migrateSubjects = async () => {
  try {
    // Get all subject keys
    const subjectKeys = await client.keys('gpt-response:*');
    console.log(`Found ${subjectKeys.length} subjects to migrate.`);

    for (let key of subjectKeys) {
      const subject = key.replace('gpt-response:', '');
      const response = await client.get(key);
      const title = await client.get(`title:${subject}`);
      const model = await client.get(`model:${subject}`);
      const summary = await client.get(`summary:${subject}`);

      // Log the fetched values to debug any potential issues
      console.log(`Migrating subject: "${subject}"`);
      console.log({ response, title, model, summary });

      // Check for undefined values and handle them
      if (response === undefined || title === undefined || model === undefined || summary === undefined || subject === undefined) {
        console.error(`Error: Undefined value found for subject "${subject}". Skipping migration for this subject.`);
        continue;
      }

      // Generate a new SUBJECT_ID
      const subjectId = await getNextSubjectId();

      // Store the data with the new SUBJECT_ID
      await client.set(`gpt-response:${subjectId}`, response);
      await client.set(`title:${subjectId}`, title);
      await client.set(`model:${subjectId}`, model);
      await client.set(`summary:${subjectId}`, summary);
      await client.set(`subject:${subjectId}`, subject);

      console.log(`Migrated subject "${subject}" to subject ID ${subjectId}`);

      // Delete the old keys
      await client.del(key);
      await client.del(`title:${subject}`);
      await client.del(`model:${subject}`);
      await client.del(`summary:${subject}`);
    }

    console.log('Migration completed successfully!');
  } catch (error) {
    console.error('Error during migration:', error);
  } finally {
    client.quit();
  }
};

migrateSubjects();
