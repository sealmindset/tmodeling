# Threat Analysis Model Generator

**Version**: 0.1  
**Author**: sealmindset

## Description
This is a threat modeling tool that interfaces with Redis for data management and the OpenAI API for generating detailed threat analyses. It allows users to input specific subjects (such as a software or technology) and receive a list of potential security threats associated with that subject. 

## Key Features
- Interactive Threat Generation: Users can request the analysis of new subjects or additional threats for existing subjects directly through a web interface.
- Threat Model Storage: All generated threat models are stored in Redis, making it easy to retrieve and update models without re-generating them.
- Scalable Architecture: Utilizing Redis for session management and threat model storage, combined with the power of the OpenAI API for generating rich, intelligent content, the app is designed to be scalable and efficient.

## Prerequisites

- OpenAI API Key
- Redis Server
- Node.JS with Express installed on your machine

### Configuration Files

#### `.env` File
Located in the root directory of this project, this file should contain:

```plaintext
API_KEY='your openai-api-key'
REDIS_HOST=localhost
REDIS_PORT=6379
```

#### `prompt-template.txt` File
The prompt-template.txt file stores the template for querying the OpenAI API to create threat models.

The placeholder is "SUBJECT" and must be capitalized to allow for the dynamic substitution, allowing the prompt to be reused for any threat subject entered at the UI. This helps provide consistent and tailored threat modeling responses. For example:

```plaintext
What threats is SUBJECT susceptible to?
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
