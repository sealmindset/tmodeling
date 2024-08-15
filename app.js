require('dotenv').config();
const express = require('express');
const axios = require('axios');
const redis = require('redis');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const naturalCompare = require('natural-compare');
const session = require('express-session');
const passport = require('passport');

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
  socket: {
    host: redisHost,
    port: redisPort,
  },
  password: process.env.REDIS_PASSWORD,
});

client.on('error', (err) => {
  console.error('Redis error: ', err);
});

client
  .connect()
  .then(() => console.log('Connected to Redis successfully!'))
  .catch(console.error);

app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));
app.use(bodyParser.json({ limit: '10mb' }));
app.set('view engine', 'ejs');
app.use(express.static('public'));

// Session setup
app.use(
  session({
    secret: 'your-secret',
    resave: false,
    saveUninitialized: true,
  })
);

app.use(passport.initialize());
app.use(passport.session());

// Passport serialization
passport.serializeUser((user, done) => {
  done(null, user.email); // Use email as the unique identifier
});

passport.deserializeUser(async (email, done) => {
  try {
    const user = await client.hGetAll(`user:${email}`);
    done(null, user);
  } catch (err) {
    done(err, null);
  }
});

// Registration routes
app.get('/register', (req, res) => {
  res.render('register'); // Render the registration page
});

app.post('/register', async (req, res) => {
  const { name, email } = req.body;

  try {
    const userId = `user:${email}`;
    const userExists = await client.exists(userId);

    if (userExists) {
      res.send('User already registered.');
      return;
    }

    await client.hSet(userId, {
      name,
      email,
      registered: 'true', // Ensure 'true' is a string
    });

    console.log(`User registered with email: ${email}`);
    res.redirect('/login'); // Redirect to login after successful registration
  } catch (error) {
    console.error('Error registering user:', error);
    res.status(500).send('Error registering user.');
  }
});

// OAuth routes and strategies
require('./auth')(app);

// Middleware to ensure the user is authenticated
function ensureAuthenticated(req, res, next) {
  if (req.isAuthenticated()) {
    return next();
  }
  res.redirect('/login');
}

// Routes for your application
const promptTemplate = fs.readFileSync(promptTemplatePath, 'utf-8');
const promptSummary = fs.readFileSync(promptSummaryPath, 'utf-8');

const getAllSubjectsWithTitles = async () => {
  try {
    const keys = await client.keys('subject:*:title');
    const subjects = keys.map((key) => key.split(':')[1]);
    const titlesPromises = keys.map((key) => client.get(key));
    const titles = await Promise.all(titlesPromises);
    return subjects.map((subjectid, index) => ({ subjectid, title: titles[index] }));
  } catch (err) {
    console.error('Error fetching subjects:', err);
    throw err;
  }
};

const getFullResponse = async (subjectid) => {
  try {
    const cacheKey = `subject:${subjectid}:response`;
    const response = await client.get(cacheKey);
    return response;
  } catch (err) {
    console.error('Error fetching response:', err);
    throw err;
  }
};

const getSummary = async (subjectid) => {
  try {
    const summaryKey = `subject:${subjectid}:summary`;
    const summary = await client.get(summaryKey);
    return summary;
  } catch (err) {
    console.error('Error fetching summary:', err);
    throw err;
  }
};

const getModel = async (subjectid) => {
  try {
    const modelKey = `subject:${subjectid}:model`;
    const model = await client.get(modelKey);
    return model;
  } catch (err) {
    console.error('Error fetching model:', err);
    throw err;
  }
};

const getSubjectText = async (subjectid) => {
  try {
    const subjectKey = `subject:${subjectid}:text`;
    const subjectText = await client.get(subjectKey);
    return subjectText;
  } catch (err) {
    console.error('Error fetching subject text:', err);
    throw err;
  }
};

app.get('/', ensureAuthenticated, async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const pageSize = 10;

  try {
    let subjectsWithTitles = await getAllSubjectsWithTitles();
    subjectsWithTitles.sort((a, b) => naturalCompare(a.title, b.title));

    const totalSubjects = subjectsWithTitles.length;
    const totalPages = Math.ceil(totalSubjects / pageSize);
    const currentPage = page;

    const paginatedSubjects = subjectsWithTitles.slice(
      (page - 1) * pageSize,
      page * pageSize
    );

    const models = fs
      .readFileSync('models.txt', 'utf-8')
      .split('\n')
      .filter(Boolean);

    res.render('index', {
      user: req.user,
      subjects: paginatedSubjects,
      currentPage,
      totalPages,
      models,
    });
  } catch (err) {
    res.send('Error retrieving previous subjects.');
  }
});

app.post('/ask', ensureAuthenticated, async (req, res) => {
  const subjectText = req.body.subject;
  const model = req.body.model || 'gpt-4o';

  try {
    const subjectid = await client.incr('subject_id_counter');
    const cacheKey = `subject:${subjectid}:response`;
    const titleKey = `subject:${subjectid}:title`;
    const modelKey = `subject:${subjectid}:model`;
    const subjectKey = `subject:${subjectid}:text`;

    const promptTemplate = fs.readFileSync(promptTemplatePath, 'utf-8');
    const prompt = promptTemplate.replace('SUBJECT', subjectText);

    let cachedResponse = await client.get(cacheKey);
    if (cachedResponse) {
      res.redirect(`/results?subjectid=${encodeURIComponent(subjectid)}`);
    } else {
      const response = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        {
          model,
          messages: [{ role: 'user', content: prompt }],
        },
        {
          headers: {
            Authorization: `Bearer ${openaiApiKey}`,
          }
        }
      );

      const apiResponse = response.data.choices[0].message.content;
      await client.set(cacheKey, apiResponse, { EX: 3600 });
      await client.set(titleKey, subjectText);
      await client.set(modelKey, model);
      await client.set(subjectKey, subjectText);
      res.redirect(`/results?subjectid=${encodeURIComponent(subjectid)}`);
    }
  } catch (error) {
    console.error('Error communicating with GPT-4 API:', error);
    res.send('Error communicating with GPT-4 API.');
  }
});

app.get('/search-titles', ensureAuthenticated, async (req, res) => {
  const query = req.query.query.toLowerCase();

  try {
    const subjectsWithTitles = await getAllSubjectsWithTitles();
    const results = subjectsWithTitles.filter((subjectObj) =>
      subjectObj.title.toLowerCase().includes(query)
    );

    res.json({ results });
  } catch (err) {
    console.error('Error searching titles:', err);
    res.status(500).send('Error searching titles');
  }
});

app.get('/results', ensureAuthenticated, async (req, res) => {
  const { subjectid } = req.query;
  let response, title, summary, model, subjectText;

  try {
    response = await getFullResponse(subjectid);
    title = await client.get(`subject:${subjectid}:title`);
    summary = await getSummary(subjectid);
    model = await getModel(subjectid);
    subjectText = await getSubjectText(subjectid);
  } catch (error) {
    console.error('Error fetching response from Redis:', error);
    res.send('Error fetching response from Redis.');
    return;
  }

  res.render('results', {
    subjectid,
    subjectText,
    response,
    title,
    summary,
    model,
    user: req.user,
  });
});

app.get('/get-summary', ensureAuthenticated, async (req, res) => {
  const { subjectid } = req.query;

  try {
    const summary = await getSummary(subjectid);
    if (summary) {
      res.json({ success: true, summary });
    } else {
      res.json({ success: false, error: 'No summary found' });
    }
  } catch (error) {
    console.error('Error fetching summary from Redis:', error);
    res.json({ success: false, error: 'Error fetching summary from Redis' });
  }
});

app.post('/edit', ensureAuthenticated, async (req, res) => {
  const { subjectid, subjectText, editedResponse, title } = req.body;
  const cacheKey = `subject:${subjectid}:response`;
  const titleKey = `subject:${subjectid}:title`;
  const subjectKey = `subject:${subjectid}:text`;

  try {
    await client.set(cacheKey, editedResponse);
    await client.set(titleKey, title);
    await client.set(subjectKey, subjectText);
    res.redirect(`/results?subjectid=${encodeURIComponent(subjectid)}`);
  } catch (error) {
    console.error('Error updating response:', error);
    res.send('Error updating response.');
  }
});

app.post('/delete-subjects', ensureAuthenticated, async (req, res) => {
  const subjectsToDelete = req.body.subjectsToDelete;

  if (!subjectsToDelete) {
    res.redirect('/');
    return;
  }

  try {
    const deletePromises = Array.isArray(subjectsToDelete)
      ? subjectsToDelete.map((subjectid) => {
          return Promise.all([
            client.del(`subject:${subjectid}:response`),
            client.del(`subject:${subjectid}:title`),
            client.del(`subject:${subjectid}:summary`),
            client.del(`subject:${subjectid}:model`),
            client.del(`subject:${subjectid}:text`),
          ]);
        })
      : [
          client.del(`subject:${subjectsToDelete}:response`),
          client.del(`subject:${subjectsToDelete}:title`),
          client.del(`subject:${subjectsToDelete}:summary`),
          client.del(`subject:${subjectsToDelete}:model`),
          client.del(`subject:${subjectsToDelete}:text`),
        ];

    await Promise.all(deletePromises);
    res.redirect('/');
  } catch (error) {
    console.error('Error deleting subjects:', error);
    res.send('Error deleting subjects.');
  }
});

app.post('/generate-more', ensureAuthenticated, async (req, res) => {
  const { subjectid } = req.body;
  const cacheKey = `subject:${subjectid}:response`;

  try {
    let existingResponse = await getFullResponse(subjectid);
    if (!existingResponse) existingResponse = '';

    const model = (await getModel(subjectid)) || 'gpt-4o';
    const subjectText = await getSubjectText(subjectid);
    const prompt =
      promptTemplate.replace('SUBJECT', subjectText) +
      '\nContinue generating more results:';
    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model,
        messages: [{ role: 'user', content: prompt }],
      },
      {
        headers: {
          Authorization: `Bearer ${openaiApiKey}`,
        }
      }
    );

    const newResponse = response.data.choices[0].message.content;
    const updatedResponse = `${existingResponse}\n\n${newResponse}`.trim();

    await client.set(cacheKey, updatedResponse);
    res.redirect(`/results?subjectid=${encodeURIComponent(subjectid)}`);
  } catch (error) {
    console.error('Error generating more results:', error);
    res.send('Error generating more results.');
  }
});

app.post('/generate-summary', ensureAuthenticated, async (req, res) => {
  const { subjectid } = req.body;
  const cacheKey = `subject:${subjectid}:response`;
  const summaryKey = `subject:${subjectid}:summary`;

  try {
    console.log('Generating summary for subjectid:', subjectid);
    const existingResponse = await getFullResponse(subjectid);
    if (!existingResponse) {
      throw new Error('No existing response found for subject');
    }

    const subjectText = await getSubjectText(subjectid);
    const model = await getModel(subjectid); // Retrieve the model dynamically

    const promptSummary = fs.readFileSync(promptSummaryPath, 'utf-8');
    const prompt = `${promptSummary} ${subjectText} ${existingResponse}`;

    console.log('Prompt for summary:', prompt);

    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model,
        messages: [{ role: 'user', content: prompt }],
      },
      {
        headers: {
          Authorization: `Bearer ${openaiApiKey}`,
        },
        timeout: 60000, // 60 seconds timeout
      }
    );

    const summary = response.data.choices[0].message.content;
    console.log('Generated summary:', summary);

    await client.set(summaryKey, summary);
    res.json({ success: true, summary });
  } catch (error) {
    console.error('Error generating summary:', error.message);
    console.error('Error stack trace:', error.stack);

    if (error.response) {
      if (error.response.status === 429) {
        res
          .status(429)
          .json({ success: false, error: 'Too Many Requests. Please try again later.' });
      } else {
        res
          .status(error.response.status)
          .json({ success: false, error: error.response.statusText });
      }
    } else if (error.code === 'ECONNRESET') {
      res
        .status(500)
        .json({ success: false, error: 'Connection was reset. Please try again.' });
    } else if (error.code === 'ETIMEDOUT') {
      res
        .status(500)
        .json({ success: false, error: 'Request timed out. Please try again.' });
    } else if (error.message.includes('timeout')) {
      res
        .status(500)
        .json({ success: false, error: 'Request timed out. Please try again.' });
    } else {
      res.status(500).json({ success: false, error: 'Internal Server Error' });
    }
  }
});

app.post('/save-summary', ensureAuthenticated, async (req, res) => {
  const { content } = req.body;
  const versionedSummaryPath = (version) =>
    path.join(__dirname, `prompt-summary-v${version}.txt`);

  try {
    let version = 1;
    while (fs.existsSync(versionedSummaryPath(version))) {
      version += 1;
    }

    await fs.promises.copyFile(promptSummaryPath, versionedSummaryPath(version));

    await fs.promises.writeFile(promptSummaryPath, content, 'utf-8');

    res.sendStatus(200);
  } catch (error) {
    console.error('Error saving summary:', error);
    res.status(500).send('Error saving summary');
  }
});

app.post('/save-modified-summary', ensureAuthenticated, async (req, res) => {
  const { subjectid, summary } = req.body;
  const summaryKey = `subject:${subjectid}:summary`;

  try {
    await client.set(summaryKey, summary);
    res.json({ success: true });
  } catch (error) {
    console.error('Error saving modified summary:', error);
    res.json({ success: false, error: 'Error saving modified summary' });
  }
});

app.post('/update-merged-content', ensureAuthenticated, async (req, res) => {
  const { subjectid, mergedContent } = req.body;
  const cacheKey = `subject:${subjectid}:response`;

  console.log(`Received request to update content for ${subjectid}`);
  console.log(`Merged content: ${mergedContent}`);

  try {
    await client.set(cacheKey, mergedContent);
    console.log('Content updated successfully in Redis');
    res.json({ success: true });
  } catch (error) {
    console.error('Error saving merged content:', error);
    res.json({ success: false, error: 'Error saving merged content' });
  }
});

app.get('/template', ensureAuthenticated, (req, res) => {
  fs.readFile(promptTemplatePath, 'utf-8', (err, data) => {
    if (err) {
      return res.status(500).send('Error reading template file');
    }
    res.send(data);
  });
});

app.get('/summary', ensureAuthenticated, (req, res) => {
  fs.readFile(promptSummaryPath, 'utf-8', (err, data) => {
    if (err) {
      return res.status(500).send('Error reading summary file');
    }
    res.send(data);
  });
});

app.get('/results-format', ensureAuthenticated, (req, res) => {
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

app.post('/save-template', ensureAuthenticated, async (req, res) => {
  const { content } = req.body;
  const versionedTemplatePath = (version) =>
    path.join(__dirname, `prompt-template-v${version}.txt`);

  try {
    let version = 1;
    while (fs.existsSync(versionedTemplatePath(version))) {
      version += 1;
    }

    await fs.promises.copyFile(promptTemplatePath, versionedTemplatePath(version));

    await fs.promises.writeFile(promptTemplatePath, content, 'utf-8');

    res.sendStatus(200);
  } catch (error) {
    console.error('Error saving template:', error);
    res.status(500).send('Error saving template');
  }
});

// API endpoints for RWEs
async function getAllRwes() {
  const keys = await client.keys('rwe:*');
  const rwes = [];

  for (const key of keys) {
    const rweid = key.split(':')[1];
    const rwe = await getRweById(rweid);
    rwes.push({ rweid, ...rwe });
  }

  return rwes;
}

async function getRweById(rweid) {
  const hashKey = `rwe:${rweid}`;
  const rwe = await client.hGetAll(hashKey);

  if (Object.keys(rwe).length === 0) {
    throw new Error(`RWE with id ${rweid} does not exist`);
  }

  return rwe;
}

app.post('/add-rwe', ensureAuthenticated, async (req, res) => {
  const { threat, description, reference } = req.body;

  try {
    const rweid = await client.incr('rwe_id_counter');
    await createRweHash(rweid, threat, description, reference);
    res.json({ success: true });
  } catch (err) {
    console.error('Error adding RWE:', err);
    res.json({ success: false, error: 'Error adding RWE' });
  }
});

app.get('/list-rwes', ensureAuthenticated, async (req, res) => {
  try {
    const rwes = await getAllRwes();
    res.json({ success: true, rwes });
  } catch (err) {
    console.error('Error listing RWEs:', err);
    res.json({ success: false, error: 'Error listing RWEs' });
  }
});

const pageSize = 9; // 3x3 grid

app.get('/list-rwes-paginated', ensureAuthenticated, async (req, res) => {
  const page = parseInt(req.query.page) || 1;

  try {
    const rwes = await getAllRwes();
    const totalRwes = rwes.length;
    const totalPages = Math.ceil(totalRwes / pageSize);
    const paginatedRwes = rwes.slice(
      (page - 1) * pageSize,
      page * pageSize
    );

    res.json({ success: true, rwes: paginatedRwes, totalPages, currentPage: page });
  } catch (err) {
    console.error('Error listing RWEs:', err);
    res.json({ success: false, error: 'Error listing RWEs' });
  }
});

app.get('/get-rwe/:rweid', ensureAuthenticated, async (req, res) => {
  const { rweid } = req.params;

  try {
    const rwe = await getRweById(rweid);
    res.json({ success: true, rwe });
  } catch (err) {
    console.error('Error getting RWE:', err);
    res.json({ success: false, error: 'Error getting RWE' });
  }
});

app.post('/update-rwe/:rweid', ensureAuthenticated, async (req, res) => {
  const { rweid } = req.params;
  const { threat, description, reference } = req.body;
  const hashKey = `rwe:${rweid}`;

  try {
    await client.hSet(hashKey, { threat, description, reference });
    res.json({ success: true });
  } catch (err) {
    console.error('Error updating RWE:', err);
    res.json({ success: false, error: 'Error updating RWE' });
  }
});

app.delete('/delete-rwe/:rweid', ensureAuthenticated, async (req, res) => {
  const { rweid } = req.params;
  const hashKey = `rwe:${rweid}`;

  try {
    await client.del(hashKey);
    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting RWE:', err);
    res.json({ success: false, error: 'Error deleting RWE' });
  }
});

// Login route
app.get('/login', (req, res) => {
  res.render('login');
});

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
