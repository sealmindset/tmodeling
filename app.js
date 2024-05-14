require('dotenv').config();
const express = require('express');
const axios = require('axios');
const redis = require('redis');
const bodyParser = require('body-parser');
const fs = require('fs');
const app = express();
const port = process.env.PORT || 3000;

const redisHost = process.env.REDIS_HOST || 'localhost';
const redisPort = process.env.REDIS_PORT || 6379;
const openaiApiKey = process.env.API_KEY;

if (!openaiApiKey) {
  console.error('OpenAI API key is not set. Please check your .env file.');
  process.exit(1);
}

const client = redis.createClient({
  url: `redis://${redisHost}:${redisPort}`
});

client.on('error', (err) => {
  console.error('Redis error: ', err);
});

client.connect()
  .then(() => console.log('Connected to Redis successfully!'))
  .catch(console.error);

app.use(bodyParser.urlencoded({ extended: true }));
app.set('view engine', 'ejs');
app.use(express.static('public'));

const promptTemplate = fs.readFileSync('prompt-template.txt', 'utf-8');

// Utility function to get all subjects
const getAllSubjects = async () => {
  try {
    const keys = await client.keys('gpt-response:*');
    return keys.map(key => key.replace('gpt-response:', ''));
  } catch (err) {
    console.error('Error fetching subjects:', err);
    throw err;
  }
};

// Utility function to get the full response for a subject
const getFullResponse = async (subject) => {
  try {
    const cacheKey = `gpt-response:${subject}`;
    const response = await client.get(cacheKey);
    return response;
  } catch (err) {
    console.error('Error fetching response:', err);
    throw err;
  }
};

app.get('/', async (req, res) => {
  try {
    const subjects = await getAllSubjects();
    res.render('index', { subjects });
  } catch (err) {
    res.send('Error retrieving previous subjects.');
  }
});

app.post('/ask', async (req, res) => {
  const subject = req.body.subject;
  const prompt = promptTemplate.replace('SUBJECT', subject);
  const cacheKey = `gpt-response:${subject}`;

  try {
    let cachedResponse = await client.get(cacheKey);
    if (cachedResponse) {
      res.redirect(`/results?subject=${encodeURIComponent(subject)}`);
    } else {
      const response = await axios.post('https://api.openai.com/v1/chat/completions', {
        model: 'gpt-4',
        messages: [{ role: 'user', content: prompt }],
      }, {
        headers: {
          'Authorization': `Bearer ${openaiApiKey}`,
        },
      });

      const apiResponse = response.data.choices[0].message.content;
      await client.set(cacheKey, apiResponse, { EX: 3600 }); // Cache for 1 hour
      res.redirect(`/results?subject=${encodeURIComponent(subject)}`);
    }
  } catch (error) {
    console.error('Error communicating with GPT-4 API:', error);
    res.send('Error communicating with GPT-4 API.');
  }
});

app.get('/results', async (req, res) => {
  const { subject } = req.query;
  let response;

  try {
    response = await getFullResponse(subject);
  } catch (error) {
    console.error('Error fetching response from Redis:', error);
    res.send('Error fetching response from Redis.');
    return;
  }

  res.render('results', { subject: decodeURIComponent(subject), response });
});

app.post('/edit', async (req, res) => {
  const { subject, editedResponse } = req.body;
  const cacheKey = `gpt-response:${subject}`;

  try {
    await client.set(cacheKey, editedResponse);
    res.redirect(`/results?subject=${encodeURIComponent(subject)}`);
  } catch (error) {
    console.error('Error updating response:', error);
    res.send('Error updating response.');
  }
});

app.post('/delete-subjects', async (req, res) => {
  const subjectsToDelete = req.body.subjectsToDelete;

  if (!subjectsToDelete) {
    res.redirect('/');
    return;
  }

  try {
    const deletePromises = Array.isArray(subjectsToDelete)
      ? subjectsToDelete.map(subject => client.del(`gpt-response:${subject}`))
      : [client.del(`gpt-response:${subjectsToDelete}`)];

    await Promise.all(deletePromises);
    res.redirect('/');
  } catch (error) {
    console.error('Error deleting subjects:', error);
    res.send('Error deleting subjects.');
  }
});

app.post('/generate-more', async (req, res) => {
  const subject = req.body.subject;
  const cacheKey = `gpt-response:${subject}`;

  try {
    let existingResponse = await getFullResponse(subject);
    if (!existingResponse) existingResponse = '';

    const prompt = promptTemplate.replace('SUBJECT', subject) + "\nContinue generating more results:";
    const response = await axios.post('https://api.openai.com/v1/chat/completions', {
      model: 'gpt-4',
      messages: [{ role: 'user', content: prompt }],
    }, {
      headers: {
        'Authorization': `Bearer ${openaiApiKey}`,
      },
    });

    const newResponse = response.data.choices[0].message.content;
    const updatedResponse = `${existingResponse}\n\n${newResponse}`.trim();

    await client.set(cacheKey, updatedResponse);
    res.redirect(`/results?subject=${encodeURIComponent(subject)}`);
  } catch (error) {
    console.error('Error generating more results:', error);
    res.send('Error generating more results.');
  }
});

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
