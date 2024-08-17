const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const GitHubStrategy = require('passport-github2').Strategy;
const redis = require('redis');

// Redis client setup
const redisHost = process.env.REDIS_HOST || 'localhost';
const redisPort = process.env.REDIS_PORT || 6379;

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

module.exports = (app) => {
  // Passport session setup
  passport.serializeUser((user, done) => {
    console.log('Serializing user:', user);
    done(null, user.email); // Serialize by email
  });

  passport.deserializeUser(async (email, done) => {
    try {
      console.log('Deserializing user with email:', email);
      const user = await client.hGetAll(`user:${email}`);
      if (Object.keys(user).length === 0) {
        console.log('No user found for email:', email);
        return done(null, false);
      }
      console.log('User deserialized:', user);
      done(null, user);
    } catch (err) {
      console.error('Error during deserialization:', err);
      done(err, null);
    }
  });

  // Check if user is registered
  const checkUserRegistration = async (profile) => {
    try {
      const userId = `user:${profile.emails[0].value}`;
      const userExists = await client.exists(userId);
      console.log(`Checking registration for user: ${userId}, exists: ${userExists}`);
      return userExists;
    } catch (err) {
      console.error('Error checking user registration:', err);
      return false;
    }
  };

  // Use the Google strategy within Passport.
  passport.use(
    new GoogleStrategy(
      {
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL: process.env.GOOGLE_CALLBACK_URL,
      },
      async function (accessToken, refreshToken, profile, done) {
        console.log('Google Strategy called with profile:', profile);
        const userExists = await checkUserRegistration(profile);
        if (!userExists) {
          console.log('User not registered:', profile.emails[0].value);
          return done(null, false, { message: 'Please register before using Google login.' });
        }
        const user = await client.hGetAll(`user:${profile.emails[0].value}`);
        console.log('User found:', user);
        req.user = user;
        return done(null, user);
      }
    )
  );

  // Use the GitHub strategy within Passport.
  passport.use(
    new GitHubStrategy(
      {
        clientID: process.env.GITHUB_CLIENT_ID,
        clientSecret: process.env.GITHUB_CLIENT_SECRET,
        callbackURL: process.env.GITHUB_CALLBACK_URL,
      },
      async function (accessToken, refreshToken, profile, done) {
        console.log('GitHub Strategy called with profile:', profile);
        const userExists = await checkUserRegistration(profile);
        if (!userExists) {
          console.log('User not registered:', profile.emails[0].value);
          return done(null, false, { message: 'Please register before using GitHub login.' });
        }
        const user = await client.hGetAll(`user:${profile.emails[0].value}`);
        console.log('User found:', user);
        return done(null, user);
      }
    )
  );

  // Initialize Passport and restore authentication state, if any, from the session.
  app.use(passport.initialize());
  app.use(passport.session());

  // Routes for Google authentication
  app.get('/auth/google',
    passport.authenticate('google', { scope: ['profile', 'email'] })
  );

  app.get('/auth/google/callback',
    passport.authenticate('google', { failureRedirect: '/login' }),
    (req, res) => {
      if (!req.user) {
        res.redirect('/register');
      } else {
        console.log('Google authentication successful, redirecting to /');
        res.redirect('/');
      }
    }
  );

  // Routes for GitHub authentication
  app.get('/auth/github',
    passport.authenticate('github', { scope: ['user:email'] })
  );

  app.get('/auth/github/callback',
    passport.authenticate('github', { failureRedirect: '/login' }),
    (req, res) => {
      if (!req.user) {
        res.redirect('/register');
      } else {
        console.log('GitHub authentication successful, redirecting to /');
        res.redirect('/');
      }
    }
  );

  // Logout route
  app.get('/logout', (req, res, next) => {
    req.logout((err) => {
      if (err) {
        return next(err);
      }
      console.log('User logged out successfully');
      res.redirect('/');
    });
  });
};
