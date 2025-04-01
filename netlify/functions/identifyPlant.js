// This is the code for our secure 'back room' function (identifyPlant.js)
// It runs on Netlify's servers, not in the user's browser.

// We need the 'fetch' capability on the server
const fetch = require('node-fetch');

// This is the main function Netlify will run when called
exports.handler = async (event, context) => {
  // 1. Get the image data sent from the website
  //    The website will send it in the 'body' of the request
  let requestBody;
  try {
    requestBody = JSON.parse(event.body);
  } catch (e) {
    console.error("Bad request body:", e);
    return {
      statusCode: 400, // Bad Request
      body: JSON.stringify({ error: 'Invalid request format.' }),
    };
  }
  
  // Make sure we actually got image data
  if (!requestBody || !requestBody.imageData || !requestBody.mimeType) {
    console.error("Missing image data in request");
    return {
      statusCode: 400, // Bad Request
      body: JSON.stringify({ error: 'Missing image data.' }),
    };
  }
  
  const { imageData, mimeType } = requestBody;
  
  // 2. Get the secret API Key safely from Netlify's settings
  //    IMPORTANT: We will set this 'GEMINI_API_KEY_SECRET' in Netlify later.
  //    It's NOT written directly in the code!
  const apiKey = process.env.GEMINI_API_KEY_SECRET;
  
  if (!apiKey) {
    console.error("API Key not found in environment variables!");
    return {
      statusCode: 500, // Internal Server Error
      body: JSON.stringify({ error: 'Server configuration error. Identification service unavailable.' }),
    };
  }
  
  // 3. Prepare the request to send to the *real* Google Gemini API
  const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${apiKey}`;
  
  // The prompt we send to Gemini (same as before, with plant check)
  const prompt = `Analyze the provided image. First, determine if the main subject of the image is a plant (flower, leaf, tree, shrub, etc.).

IF the image IS primarily a plant:
Respond ONLY with a valid JSON object containing the following keys: 'isPlant' (set to true), 'commonName', 'scientificName', 'description', 'habitatOrigin', and 'careTips'.
Instructions for plant details:
- 'commonName': The common name of the identified plant.
- 'scientificName': The scientific (botanical) name of the identified plant.
- 'description': Provide a general description of the plant (its key characteristics, uses, etc.), NOT just what's in the image. Strictly limit this description to approximately 180 characters.
- 'habitatOrigin': Describe the plant's typical native habitat and origin. Strictly limit this information to approximately 110 characters.
- 'careTips': Provide essential care tips as a single string. Separate each tip with a newline character (\\n), and start each tip with '- '.

Example JSON response for a plant:
{
  "isPlant": true,
  "commonName": "Example Plant",
  "scientificName": "Exemplum botanicum",
  "description": "A versatile herb known for its culinary uses and aromatic leaves. Often grown in gardens or pots. Reaches about 60cm in height. (Approx 180 chars)",
  "habitatOrigin": "Native to the Mediterranean region. Prefers sunny locations and well-drained soil. Tolerant of drought. (Approx 110 chars)",
  "careTips": "- Full sun needed\\n- Water moderately\\n- Prune after flowering"
}

IF the image IS NOT primarily a plant:
Respond ONLY with the following valid JSON object:
{
  "isPlant": false,
  "error": "The uploaded image does not appear to be a plant or is not clear enough for identification."
}

Strictly adhere to ONE of these two JSON formats. Output ONLY the raw JSON object without any introductory text, explanations, markdown formatting, or code block markers (\`\`\`).`;
  
  const geminiRequestBody = {
    contents: [{
      parts: [
        { text: prompt },
        {
          inline_data: {
            mime_type: mimeType,
            data: imageData // The image data received from the website
          }
        }
      ]
    }],
    generationConfig: { temperature: 0.4 },
    safetySettings: [
      { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
      { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
      { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
      { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
    ]
  };
  
  // 4. Make the actual call to Gemini (safely from the server)
  try {
    console.log("Sending request to Gemini API..."); // Log for debugging on Netlify
    const response = await fetch(GEMINI_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(geminiRequestBody)
    });
    
    // Check if Gemini responded with an error
    if (!response.ok) {
      const errorBody = await response.text(); // Get raw text in case JSON parsing fails
      console.error(`Gemini API Error (${response.status}):`, errorBody);
      // Return a generic error to the website user
      return {
        statusCode: 502, // Bad Gateway (error communicating with upstream server)
        body: JSON.stringify({ error: 'The identification service returned an error. Please try again.' }),
      };
    }
    
    // Get the response data from Gemini
    const geminiData = await response.json();
    console.log("Received response from Gemini API."); // Log for debugging
    
    // Check for safety blocks or missing data from Gemini (more robust checks)
    if (geminiData?.promptFeedback?.blockReason) {
      console.error('Gemini Response Blocked:', geminiData.promptFeedback);
      return {
        statusCode: 400, // Bad Request (from user perspective, bad image maybe)
        body: JSON.stringify({ error: `The image could not be processed due to content restrictions.` }),
      };
    }
    if (!geminiData.candidates || !geminiData.candidates[0].content || !geminiData.candidates[0].content.parts || !geminiData.candidates[0].content.parts[0].text) {
      const finishReason = geminiData.candidates?.[0]?.finishReason;
      console.error(`Gemini response structure invalid. Finish Reason: ${finishReason}`, geminiData);
      return {
        statusCode: 500, // Internal Server Error
        body: JSON.stringify({ error: 'Received an incomplete or invalid response from the identification service.' }),
      };
    }
    
    // 5. Send the result *back* to your website
    //    We send exactly what Gemini sent us (which should be the JSON string)
    return {
      statusCode: 200, // OK
      headers: { 'Content-Type': 'application/json' }, // Tell the browser it's JSON
      body: geminiData.candidates[0].content.parts[0].text // Pass the raw JSON text from Gemini
    };
    
  } catch (error) {
    // Catch any other errors during the fetch or processing
    console.error('Error in Netlify function:', error);
    return {
      statusCode: 500, // Internal Server Error
      body: JSON.stringify({ error: 'An unexpected error occurred during identification.' }),
    };
  }
};
