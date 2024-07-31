require('dotenv').config();
const express = require('express');
const axios = require('axios');
const redis = require('redis');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const naturalCompare = require('natural-compare');
const app = express();
const port = process.env.PORT || 3000;

const redisHost = process.env.REDIS_HOST || 'localhost';
const redisPort = process.env.REDIS_PORT || 6379;
const openaiApiKey = process.env.API_KEY;

const promptTemplatePath = path.join(__dirname, 'prompt-template.txt');
const promptSummaryPath = path.join(__dirname, 'prompt-summary.txt');
const resultsFormatPath = path.join(__dirname, 'results-format.txt');

console.log('Environment Variables:');
console.log(`API_KEY: ${openaiApiKey ? 'Set' : 'Not Set'}`);
console.log(`REDIS_HOST: ${redisHost}`);
console.log(`REDIS_PORT: ${redisPort}`);
console.log(`PORT: ${port}`);

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
app.use(bodyParser.json());
app.set('view engine', 'ejs');
app.use(express.static('public'));

const promptTemplate = fs.readFileSync(promptTemplatePath, 'utf-8');
const promptSummary = fs.readFileSync(promptSummaryPath, 'utf-8');

const getAllSubjectsWithTitles = async () => {
  try {
    const keys = await client.keys('gpt-response:*');
    const subject_ids = keys.map(key => key.replace('gpt-response:', ''));
    const subjectsPromises = subject_ids.map(subject_id => client.get(`subject:${subject_id}`));
    const titlesPromises = subject_ids.map(subject_id => client.get(`title:${subject_id}`));
    const subjects = await Promise.all(subjectsPromises);
    const titles = await Promise.all(titlesPromises);
    return subject_ids.map((subject_id, index) => ({ subject_id, subject: subjects[index], title: titles[index] }));
  } catch (err) {
    console.error('Error fetching subjects:', err);
    throw err;
  }
};

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

const getSummary = async (subject) => {
  try {
    const summaryKey = `summary:${subject}`;
    const summary = await client.get(summaryKey);
    return summary;
  } catch (err) {
    console.error('Error fetching summary:', err);
    throw err;
  }
};

const getModel = async (subject) => {
  try {
    const modelKey = `model:${subject}`;
    const model = await client.get(modelKey);
    return model;
  } catch (err) {
    console.error('Error fetching model:', err);
    throw err;
  }
};

app.get('/', async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const pageSize = 10;

  try {
    let subjectsWithTitles = await getAllSubjectsWithTitles();
    subjectsWithTitles.sort((a, b) => naturalCompare(a.title, b.title));
    
    const totalSubjects = subjectsWithTitles.length;
    const totalPages = Math.ceil(totalSubjects / pageSize);
    const currentPage = page;

    const paginatedSubjects = subjectsWithTitles.slice((page - 1) * pageSize, page * pageSize);

    const models = fs.readFileSync('models.txt', 'utf-8').split('\n').filter(Boolean);

    res.render('index', { 
      subjects: paginatedSubjects, 
      currentPage, 
      totalPages,
      models 
    });
  } catch (err) {
    res.send('Error retrieving previous subjects.');
  }
});

app.post('/ask', async (req, res) => {
  const subject = req.body.subject;
  const model = req.body.model || 'gpt-4o';
  const title = subject;
  const prompt = promptTemplate.replace('SUBJECT', subject);
  const cacheKey = `gpt-response:${subject}`;
  const titleKey = `title:${subject}`;
  const modelKey = `model:${subject}`;

  try {
    let cachedResponse = await client.get(cacheKey);
    if (cachedResponse) {
      res.redirect(`/results?subject=${encodeURIComponent(subject)}`);
    } else {
      const response = await axios.post('https://api.openai.com/v1/chat/completions', {
        model,
        messages: [{ role: 'user', content: prompt }],
      }, {
        headers: {
          'Authorization': `Bearer ${openaiApiKey}`,
        },
      });

      const apiResponse = response.data.choices[0].message.content;
      await client.set(cacheKey, apiResponse, { EX: 3600 });
      await client.set(titleKey, title);
      await client.set(modelKey, model);
      res.redirect(`/results?subject=${encodeURIComponent(subject)}`);
    }
  } catch (error) {
    console.error('Error communicating with GPT-4 API:', error);
    res.send('Error communicating with GPT-4 API.');
  }
});

app.get('/search-titles', async (req, res) => {
  const query = req.query.query.toLowerCase();

  try {
    const subjectsWithTitles = await getAllSubjectsWithTitles();
    const results = subjectsWithTitles.filter(subjectObj => 
      subjectObj.title.toLowerCase().includes(query)
    );

    res.json({ results });
  } catch (err) {
    console.error('Error searching titles:', err);
    res.status(500).send('Error searching titles');
  }
});

app.get('/results', async (req, res) => {
  const subject_id = req.query.subject_id;
  let response, title, summary, model, subject;
  console.log('/results', subject_id); // Log the subject_id for debugging purposes

  if (!subject_id) {
    res.send('Error: subject_id is required');
    return;
  }

  try {
    response = await getFullResponse(subject_id);
    subject = await client.get(`subject:${subject_id}`);
    title = await client.get(`title:${subject_id}`);
    summary = await getSummary(subject_id);
    model = await getModel(subject_id);
  } catch (error) {
    console.error('Error fetching response from Redis:', error);
    res.send('Error fetching response from Redis.');
    return;
  }

  res.render('results', { subject_id, subject, response, title, summary, model });
});

app.get('/get-summary', async (req, res) => {
  const { subject_id } = req.query;

  try {
    console.log('Fetching summary for subject_id:', subject_id); // Add logging
    const summary = await client.get(`summary:${subject_id}`);
    if (summary) {
      res.json({ success: true, summary });
    } else {
      res.json({ success: false, error: 'No summary found' });
    }
  } catch (error) {
    console.error('Error fetching summary:', error);
    res.json({ success: false, error: 'Error fetching summary' });
  }
});

app.post('/edit', async (req, res) => {
  const { subject, newSubject, editedResponse, title } = req.body;
  const oldCacheKey = `gpt-response:${subject}`;
  const oldTitleKey = `title:${subject}`;
  const newCacheKey = `gpt-response:${newSubject}`;
  const newTitleKey = `title:${newSubject}`;

  try {
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
            client.del(`title:${subject}`),
            client.del(`summary:${subject}`),
            client.del(`model:${subject}`)
          ]);
        })
      : [
          client.del(`gpt-response:${subjectsToDelete}`),
          client.del(`title:${subjectsToDelete}`),
          client.del(`summary:${subjectsToDelete}`),
          client.del(`model:${subjectsToDelete}`)
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

    const model = await getModel(subject) || 'gpt-4o';
    const prompt = promptTemplate.replace('SUBJECT', subject) + "\nContinue generating more results:";
    const response = await axios.post('https://api.openai.com/v1/chat/completions', {
      model,
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

app.post('/generate-summary', async (req, res) => {
  const { subject_id } = req.body;
  const cacheKey = `gpt-response:${subject_id}`;
  const summaryKey = `summary:${subject_id}`;

  try {
    console.log('Generating summary for subject_id:', subject_id); // Add logging
    const existingResponse = await getFullResponse(subject_id);
    if (!existingResponse) {
      throw new Error('No existing response found for subject');
    }

    const prompt = `${promptSummary}\n\nThreat Model: ${subject_id}\n\nMitigation Strategies:\n${existingResponse}`;
    console.log('Prompt for summary:', prompt); // Add logging

    const response = await axios.post('https://api.openai.com/v1/chat/completions', {
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
    }, {
      headers: {
        'Authorization': `Bearer ${openaiApiKey}`,
      },
    });

    const summary = response.data.choices[0].message.content;
    console.log('Generated summary:', summary); // Add logging

    await client.set(summaryKey, summary);
    res.json({ success: true, summary });
  } catch (error) {
    console.error('Error generating summary:', error);
    res.json({ success: false, error: 'Error generating summary' });
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

// Route to fetch the summary content
app.get('/summary', (req, res) => {
  fs.readFile(promptSummaryPath, 'utf-8', (err, data) => {
    if (err) {
      return res.status(500).send('Error reading summary file');
    }
    res.send(data);
  });
});

// Route to fetch the results format content
app.get('/results-format', (req, res) => {
  fs.readFile('results-format.txt', 'utf-8', (err, data) => {
    if (err) {
      return res.status(500).send('Error reading results format file');
    }
    try {
      const replacements = JSON.parse(data);
      res.json(replacements);
    } catch (err) {
      res.status(500).send('Error parsing results format file');
    }
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
    await fs.promises.copyFile(promptTemplatePath, versionedTemplatePath(version));

    // Save the new content as the current template
    await fs.promises.writeFile(promptTemplatePath, content, 'utf-8');

    res.sendStatus(200);
  } catch (error) {
    console.error('Error saving template:', error);
    res.status(500).send('Error saving template');
  }
});

// Route to save the edited summary content with version control
app.post('/save-summary', async (req, res) => {
  const { subject_id, summary } = req.body;

  console.log('Saving summary for subject_id:', subject_id); // Add logging
  console.log('Summary content:', summary); // Add logging

  if (!subject_id || !summary) {
    console.error('Invalid subject_id or summary content'); // Add logging
    return res.status(400).json({ success: false, error: 'Invalid subject or content' });
  }

  const summaryKey = `summary:${subject_id}`;

  try {
    await client.set(summaryKey, summary);
    console.log('Summary saved successfully'); // Add logging
    res.json({ success: true });
  } catch (error) {
    console.error('Error saving summary:', error);
    res.status(500).json({ success: false, error: 'Error saving summary' });
  }
});


app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
 
