require('dotenv').config();
const express = require('express');
const axios = require('axios');
const redis = require('redis');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const fsp = fs.promises; // Use promises for easier async/await

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
app.use(bodyParser.json()); // For parsing application/json
app.set('view engine', 'ejs');
app.use(express.static('public'));

const promptTemplatePath = path.join(__dirname, 'prompt-template.txt');
const promptTemplate = fs.readFileSync(promptTemplatePath, 'utf-8');
const CARDS_PER_PAGE = 15;

// Utility function to get all subjects with titles
const getAllSubjectsWithTitles = async () => {
  try {
    const keys = await client.keys('gpt-response:*');
    const subjects = keys.map(key => key.replace('gpt-response:', ''));
    const titlesPromises = subjects.map(subject => client.get(`title:${subject}`));
    const titles = await Promise.all(titlesPromises);
    return subjects.map((subject, index) => ({ subject, title: titles[index] }));
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
    const page = parseInt(req.query.page) || 1;
    let subjectsWithTitles = await getAllSubjectsWithTitles();
    
    // Sort subjects by title
    subjectsWithTitles.sort((a, b) => a.title.localeCompare(b.title));
    
    const totalPages = Math.ceil(subjectsWithTitles.length / CARDS_PER_PAGE);
    const paginatedSubjects = subjectsWithTitles.slice((page - 1) * CARDS_PER_PAGE, page * CARDS_PER_PAGE);
    res.render('index', { subjects: paginatedSubjects, currentPage: page, totalPages: totalPages });
  } catch (err) {
    res.send('Error retrieving previous subjects.');
  }
});

app.post('/ask', async (req, res) => {
  const subject = req.body.subject;
  const title = subject; // Initial title is the subject
  const prompt = promptTemplate.replace('SUBJECT', subject);
  const cacheKey = `gpt-response:${subject}`;
  const titleKey = `title:${subject}`;

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
      await client.set(titleKey, title); // Save the title
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
  let title;

  try {
    response = await getFullResponse(subject);
    title = await client.get(`title:${subject}`);
  } catch (error) {
    console.error('Error fetching response from Redis:', error);
    res.send('Error fetching response from Redis.');
    return;
  }

  res.render('results', { subject: decodeURIComponent(subject), response, title });
});

app.post('/edit', async (req, res) => {
  const { subject, newSubject, editedResponse, title } = req.body;
  const oldCacheKey = `gpt-response:${subject}`;
  const oldTitleKey = `title:${subject}`;
  const newCacheKey = `gpt-response:${newSubject}`;
  const newTitleKey = `title:${newSubject}`;

  try {
    // If subject is changed, update Redis keys
    if (subject !== newSubject) {
      const oldResponse = await client.get(oldCacheKey);
      const oldTitle = await client.get(oldTitleKey);
      await client.set(newCacheKey, editedResponse || oldResponse);
      await client.set(newTitleKey, title || oldTitle);
      await client.del(oldCacheKey);
      await client.del(oldTitleKey);
    } else {
      await client.set(oldCacheKey, editedResponse);
      await client.set(oldTitleKey, title);
    }
    res.redirect(`/results?subject=${encodeURIComponent(newSubject)}`);
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
      ? subjectsToDelete.map(subject => {
          return Promise.all([
            client.del(`gpt-response:${subject}`),
            client.del(`title:${subject}`)
          ]);
        })
      : [
          client.del(`gpt-response:${subjectsToDelete}`),
          client.del(`title:${subjectsToDelete}`)
        ];

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

// Route to fetch the template content
app.get('/template', (req, res) => {
  fs.readFile(promptTemplatePath, 'utf-8', (err, data) => {
    if (err) {
      return res.status(500).send('Error reading template file');
    }
    res.send(data);
  });
});

// Route to save the edited template content with version control
app.post('/save-template', async (req, res) => {
  const { content } = req.body;
  const versionedTemplatePath = (version) => path.join(__dirname, `prompt-template-v${version}.txt`);

  try {
    // Determine the next version number
    let version = 1;
    while (fs.existsSync(versionedTemplatePath(version))) {
      version += 1;
    }

    // Save the current template with version number
    await fsp.copyFile(promptTemplatePath, versionedTemplatePath(version));

    // Save the new content as the current template
    await fsp.writeFile(promptTemplatePath, content, 'utf-8');

    res.sendStatus(200);
  } catch (error) {
    console.error('Error saving template:', error);
    res.status(500).send('Error saving template');
  }
});

app.get('/search', async (req, res) => {
  const query = req.query.query.toLowerCase();
  const subjectsWithTitles = await getAllSubjectsWithTitles();
  
  const results = subjectsWithTitles.filter(item => 
    item.title.toLowerCase().includes(query)
  );

  res.json(results);
});

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
