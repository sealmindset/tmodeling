# Threat Analysis Model Generator

**Version**: 1.0  
**Author**: sealmindset

## Description
This is a threat modeling tool that interfaces with Redis for data management and the OpenAI API for generating detailed threat analyses. It allows users to input specific subjects (such as software or technology) and receive a list of potential security threats associated with that subject. 

## Key Features
- Interactive Threat Generation: Users can request the analysis of new subjects or additional threats for existing subjects directly through a web interface.
- Threat Model Storage: All generated threat models are stored in Redis, making it easy to retrieve and update models without re-generating them.
- Scalable Architecture: Utilizing Redis for session management and threat model storage, combined with the power of the OpenAI API for generating rich, intelligent content, the app is designed to be scalable and efficient.

## Prerequisites

- OpenAI API Key
- Redis Server
- Node.JS with Express installed on your local machine

### Configuration Files

#### `.env` File
Located in the root directory of this project, this file should contain:

```plaintext
REDIS_HOST=localhost
REDIS_PORT=6379
```

## Running
First run  `npm install` from within the cloned repository to ensure all dependencies are downloaded and installed.

```plaintext
npm install
```

To start the server and begin listening for requests at http://localhost:3000

```plaintext
node app.js
```

## To Do
- API Endpoint to make it consumable without needing an OpenAI account
- Improve the user interface
