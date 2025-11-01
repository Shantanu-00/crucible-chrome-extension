// src/background/background.js - Profile-First Production Pipeline
importScripts(
  '../lib/dexie.min.js',
  '../storage/databaseService.js'
);

// ==================== CONSTANTS & CONFIG ====================
// ... (your existing constants)
const MODEL_NAME = 'gemini-Nano';
const MAX_HIGHLIGHT_CHUNK_SIZE = 6000;
const PRIORITY = {
  HIGH: 1,    // User-facing: Summarize, Highlight, Relevance
  MEDIUM: 2,  // Autonomous: Search Enrichment
  LOW: 3,     // Profile Synthesis
  BACKGROUND: 4 // Long-term synthesis
};

// ... (your existing TASK_METHODS, MASTER_TOPIC_BUCKET, SCHEMAS)
const TASK_METHODS = {
  'SEARCH_ENRICHMENT': 'processSearchEnrichment',
  'PAGE_ANALYSIS': 'processPageAnalysis',
  'SUMMARIZER_CALL': 'processSummarizerCall',
  'PROMPT_API_CALL': 'processPromptApiCall',
  'HIGHLIGHT_EXTRACTION': 'processHighlightExtraction',
  'TOPIC_INFERENCE': 'processTopicInference',
  'PROFILE_SUMMARY_GENERATION': 'processProfileSummaryGeneration',

  'SUMMARIZE_CHUNK_WITH_PROFILE': 'processProfileAwareChunkSummarization',
  'GENERATE_FINAL_INSIGHT': 'processFinalInsightGeneration',
  'GENERATE_SUMMARY_OF_SUMMARIES': 'processSummaryOfSummaries'
};

const MASTER_TOPIC_BUCKET = {
  TECHNOLOGY: "Technology",
  FINANCE: "Finance", 
  ECOMMERCE: "E-commerce",
  HEALTH: "Health",
  SCIENCE: "Science",
  EDUCATION: "Education",
  TRAVEL: "Travel",
  ARTS: "Arts",
  ENTERTAINMENT: "Entertainment",
  SPORTS: "Sports",
  NEWS: "News",
  BUSINESS: "Business",
  LIFESTYLE: "Lifestyle",
  FOOD: "Food",
  AUTOMOTIVE: "Automotive",
  REAL_ESTATE: "Real Estate",
  ENVIRONMENT: "Environment",
  POLITICS: "Politics",
  CAREER: "Career",
  PARENTING: "Parenting",
  GAMING: "Gaming",
  FASHION: "Fashion",
  UNKNOWN: "Unknown"
};

const TOPIC_DOMAIN_ENUM = Object.values(MASTER_TOPIC_BUCKET);

// Enhanced search analysis schema with weighted topics
const SEARCH_ANALYSIS_SCHEMA = {
  type: "object",
  properties: {
    intentType: {
      type: "string",
      enum: ["informational", "transactional", "instructional", "navigational"]
    },
    topicDomains: {
      type: "array",
      items: {
        type: "object",
        properties: {
          topic: { type: "string", enum: TOPIC_DOMAIN_ENUM },
          weight: { type: "number", minimum: 0.0, maximum: 1.0 }
        },
        required: ["topic", "weight"],
        additionalProperties: false
      },
      minItems: 1,
      maxItems: 2
    },
    confidence: { 
      type: "number", 
      minimum: 0.0, 
      maximum: 1.0 
    },
    specificity: { 
      type: "number", 
      minimum: 0.0, 
      maximum: 1.0 
    }
  },
  required: ["intentType", "topicDomains", "confidence", "specificity"],
  additionalProperties: false
};

const TOPIC_INFERENCE_SCHEMA = {
  type: "object",
  properties: {
    topicDomains: {
      type: "array",
      items: {
        type: "object",
        properties: {
          topic: { type: "string", enum: TOPIC_DOMAIN_ENUM },
          weight: { type: "number", minimum: 0.0, maximum: 1.0 }
        },
        required: ["topic", "weight"],
        additionalProperties: false
      },
      minItems: 1,
      maxItems: 3
    }
  },
  required: ["topicDomains"],
  additionalProperties: false
};

const PAGE_ANALYSIS_SCHEMA = {
  type: "object",
  properties: {
    relevanceScore: { type: "number" },
    keyTopics: { 
      type: "array", 
      items: { type: "string", enum: TOPIC_DOMAIN_ENUM },
      minItems: 1,
      maxItems: 3
    },
    contentType: { type: "string" }
  },
  required: ["relevanceScore", "keyTopics", "contentType"],
  additionalProperties: false
};


/**
 * AIOrchestrator - Enhanced with Profile-First Pipeline
 */
class AIOrchestrator {
  // ... (your entire existing AIOrchestrator class)
  // ... (no changes needed inside AIOrchestrator)
  // ...
  constructor(dbService) {
    this.dbService = dbService;
    this.languageModel = null;
    this.summarizer = null;
    this.summarizerAvailable = false;
    this.profileSummary = null;
    this.logLevel = 'info';

    // CONCURRENCY STATE
    this.taskQueue = [];
    this.isProcessing = false;
    this.lastHeartbeat = new Date().toISOString();
    this.currentPriority = 'idle';

    // Store master topic bucket references
    this.MASTER_TOPIC_BUCKET = MASTER_TOPIC_BUCKET;
    this.TOPIC_DOMAIN_ENUM = TOPIC_DOMAIN_ENUM;
    this.SEARCH_ANALYSIS_SCHEMA = SEARCH_ANALYSIS_SCHEMA;
    this.TOPIC_INFERENCE_SCHEMA = TOPIC_INFERENCE_SCHEMA;
    this.PAGE_ANALYSIS_SCHEMA = PAGE_ANALYSIS_SCHEMA;

    this.init();
  }

  log(message, level = 'info', data = {}) {
    if (level === 'error' || level === 'warn' || this.logLevel === 'info') {
      const prefix = level === 'error' ? '[AI-ERROR]' : (level === 'warn' ? '[AI-WARN]' : '[AI-INFO]');
      console[level] ? console[level](`${prefix} ${new Date().toISOString()}: ${message}`, data) : console.log(`${prefix} ${new Date().toISOString()}: ${message}`, data);
    }
  }

  async checkSessionHealth() {
    return this.checkAndRecoverSession();
  }

  async init() {
    this.log('🔮 AI Orchestrator initialization started in Service Worker', 'info');
    await this.initializeNano();
    await this.loadUserProfileSummary();
    this.log('🔮 AI Orchestrator initialized in Service Worker', 'info');
  }

  // ==================== UPDATED NANO INITIALIZATION ====================
async initializeNano() {
  this.log('Initializing Gemini Nano APIs in Service Worker...', 'info');

  // 1. Initialize LanguageModel (Prompt API)
  if ('LanguageModel' in self) {
    try {
      const availability = await LanguageModel.availability();
      this.log(`LanguageModel availability: ${availability}`, 'debug');
      
      if (availability === 'unavailable') {
        this.log('Language Model unavailable on this device', 'warn');
      } else {
        this.languageModel = await LanguageModel.create({
          expectedInputs: [
            { type: "text", languages: ["en"] }
          ],
          expectedOutputs: [
            { type: "text", languages: ["en"] }
          ]
        });
        
        if (this.languageModel) {
          this.log('✅ Language Model session created in Service Worker', 'info');
        }
      }
    } catch (e) {
      this.log(`❌ Failed to initialize Language Model: ${e.message}`, 'error');
    }
  } else {
    this.log('LanguageModel API not available in Service Worker', 'warn');
  }

  // 2. Initialize Summarizer API - FIXED VERSION
  if ('Summarizer' in self) {
    try {
      const availability = await Summarizer.availability();
      this.log(`Summarizer availability: ${availability}`, 'debug');
      
      if (availability === 'unavailable') {
        this.log('Summarizer API unavailable on this device', 'warn');
        this.summarizerAvailable = false;
      } else {
        // For service worker context, try to create summarizer directly
        // Don't check userActivation in service worker
        try {
          this.summarizer = await Summarizer.create({
            type: 'key-points',
            format: 'plain-text',
            length: 'short',
            expectedInputLanguages: ['en'],
            outputLanguage: 'en'
          });
          this.summarizerAvailable = true;
          this.log('✅ Summarizer API initialized in Service Worker', 'info');
        } catch (createError) {
          // If creation fails due to user activation, mark as unavailable
          if (createError.message.includes('user activation') || 
              createError.message.includes('activation')) {
            this.log('Summarizer requires user activation - will use LanguageModel fallback', 'warn');
            this.summarizerAvailable = false;
          } else {
            throw createError;
          }
        }
      }
    } catch (e) {
      this.log(`Summarizer API initialization failed: ${e.message}`, 'error');
      this.summarizerAvailable = false;
    }
  } else {
    this.log('Summarizer API not available in Service Worker', 'warn');
    this.summarizerAvailable = false;
  }
}

  async checkAndRecoverSession() {
    try {
      if (!this.languageModel) {
        await this.initializeNano();
        return { healthy: !!this.languageModel, recovered: true };
      }

      const testResponse = await this.languageModel.prompt("Say 'OK'", {
        responseConstraint: { type: "string" },
        omitResponseConstraintInput: true
      }).catch(() => null);

      if (!testResponse || testResponse.includes('OK') === false) {
        this.log('Session unhealthy, attempting recovery...', 'warn');
        if (this.languageModel.destroy) {
          await this.languageModel.destroy().catch(() => {});
        }
        await this.initializeNano();
        return { healthy: !!this.languageModel, recovered: true };
      }

      return { 
        healthy: true, 
        recovered: false,
        inputQuota: this.languageModel.inputQuota,
        inputUsage: this.languageModel.inputUsage
      };
    } catch (error) {
      this.log('Session recovery failed', 'error', { error: error.message });
      return { healthy: false, recovered: false, error: error.message };
    }
  }

  // ==================== TASK SCHEDULING SYSTEM ====================
  async scheduleAITask(taskData) {
    if (!this.languageModel) {
      this.log('Language Model not available, task rejected', 'error');
      return { success: false, error: 'Language Model not available' };
    }

    try {
      const methodName = TASK_METHODS[taskData.type];
      if (!methodName || !this[methodName]) {
        this.log(`Unknown task type or method: ${taskData.type}`, 'error');
        return { success: false, error: `Unknown task type: ${taskData.type}` };
      }

      const taskFunction = async () => {
        try {
          this.log(`Executing AI task: ${taskData.type}`, 'debug', { taskId: taskData.id });
          const payload = {
            ...taskData.data,
            taskId: taskData.id
          }
          const result = await this[methodName](taskData.data || taskData);
          return { success: true, result };
        } catch (error) {
          this.log(`Task execution failed: ${taskData.type}`, 'error', { 
            taskId: taskData.id, 
            error: error.message 
          });
          return { success: false, error: error.message };
        }
      };

      const priority = taskData.priority || PRIORITY.MEDIUM;
      return await this.addToQueue(taskFunction, priority, taskData);

    } catch (error) {
      this.log(`Failed to schedule AI task: ${taskData.type}`, 'error', { 
        error: error.message 
      });
      return { success: false, error: error.message };
    }
  }

async addToQueue(taskFunction, priority, taskData) {
  return new Promise((resolve) => {
    const task = {
      priority: priority,
      execute: async () => {
        const result = await taskFunction();
        // Remove resolve call from here - we'll handle it in processQueue
        return result;
      },
      id: taskData.id || crypto.randomUUID(),
      type: taskData.type || 'unknown',
      timestamp: Date.now(),
      tabId: taskData.tabId,
      callback: taskData.callback,
      resolve: resolve // ✅ Store the resolve function
    };

    this.taskQueue.push(task);
    this.taskQueue.sort((a, b) => {
      if (a.priority !== b.priority) {
        return a.priority - b.priority;
      }
      return a.timestamp - b.timestamp;
    });
    
    this.log(`Task added to queue`, 'debug', { 
      taskId: task.id, 
      type: task.type, 
      priority,
      queueSize: this.taskQueue.length 
    });
    
    this.processQueue();
  });
}
async processQueue() {
  const health = await this.checkSessionHealth(); 
  if (!health.healthy) {
    this.log('LanguageModel session unhealthy, skipping processing', 'error', { error: health.error || 'Unknown health error' });
    this.isProcessing = false;
    return;
  }
  
  if (this.isProcessing || this.taskQueue.length === 0) {
    return;
  }

  this.isProcessing = true;
  const task = this.taskQueue.shift();
  
  this.currentPriority = `P${task.priority}-${task.type}`;
  this.lastHeartbeat = new Date().toISOString();
  
  this.log(`Processing task`, 'info', { 
    taskId: task.id, 
    type: task.type, 
    priority: task.priority 
  });
  
  let responseData;
  try {
    const result = await task.execute(); 
    
    let actualData = null;
    let actualSuccess = false;
    
    if (result && typeof result === 'object') {
      if ('success' in result) {
        actualSuccess = result.success === true;
      } else {
        actualSuccess = true;
      }
      
      if (result.data !== undefined) {
        actualData = result.data;
      } else if (result.result !== undefined) {
        actualData = result.result;
      } else if (result.analysis !== undefined) {
        actualData = result;
      } else {
        actualData = result;
      }
    }
    
    responseData = {
      success: actualSuccess,
      data: actualData,
      error: result?.error || null,
      taskId: task.id,
      taskType: task.type
    };
    
    this.log(`Task completed successfully`, 'info', { taskId: task.id });
    
  } catch (error) {
    this.log(`Task completed with unexpected errors`, 'error', { 
      taskId: task.id,
      error: error.message 
    });
    
    responseData = {
      success: false,
      data: null,
      error: error.message,
      taskId: task.id,
      taskType: task.type
    };
  }

  // ✅ Now task.resolve exists and can be called
  if (task.resolve) {
    task.resolve(responseData);
  }

  this.isProcessing = false;
  this.currentPriority = this.taskQueue.length > 0 ? `waiting-${this.taskQueue[0].type}` : 'idle';
  this.lastHeartbeat = new Date().toISOString();
  
  if (this.taskQueue.length > 0) {
    this.processQueue();
  } else {
    this.log('Task queue empty', 'info');
  }
}

  // ==================== 🎯 PROFILE-FIRST PIPELINE METHODS ====================

  /**
   * 🎯 PROFILE-AWARE CHUNK SUMMARIZATION
   */
  async processProfileAwareChunkSummarization(taskData) {
    this.log('⚡ Processing profile-aware chunk summarization', 'info', {
      chunkId: taskData.chunkId,
      score: taskData.score,
      hasProfile: !!taskData.profileSummary
    });

    try {
      const { 
        text, 
        chunkId, 
        score,
        profileSummary, 
        profileTopics,
        profileConfidence,
        profileFocusStyle 
      } = taskData;
      
      if (!text || typeof text !== 'string') {
        throw new Error('Invalid text for chunk summarization');
      }

      let summary = '';
      let title = '';

      // Try native Summarizer API first with profile context
      if (this.summarizerAvailable && this.summarizer) {
        this.log('Using Summarizer API with profile context', 'info');
        
        try {
          const profileContext = this.buildProfileContext(
            profileSummary, 
            profileTopics, 
            profileConfidence,
            profileFocusStyle
          );
          
          // Generate summary using Summarizer API
          summary = await this.summarizer.summarize(text, {
            context: profileContext,
            ...this.getSummarizerConfig(profileFocusStyle)
          });

          // Generate title using headline summarizer
          title = await this.generateChunkTitleWithSummarizer(text);
          
          this.log('✅ Profile-aware summarization complete (Summarizer API)', 'info');
          
        } catch (summarizerError) {
          this.log('Summarizer API failed, falling back to LanguageModel', 'warn', {
            error: summarizerError.message
          });
          
          const result = await this.fallbackProfileAwareSummarization(
            text, 
            profileSummary, 
            profileTopics,
            profileFocusStyle
          );
          
          summary = result.summary;
          title = result.title;
        }
      } else {
        const result = await this.fallbackProfileAwareSummarization(
          text, 
          profileSummary, 
          profileTopics,
          profileFocusStyle
        );
        
        summary = result.summary;
        title = result.title;
      }

      summary = this.cleanSummarizerOutput(summary, { format: 'plain-text', length: 'short' });
      title = this.cleanTitle(title);

      this.log('✅ Profile-aware chunk summarization completed', 'info', {
        chunkId,
        summaryLength: summary.length,
        titleLength: title.length
      });

      return {
        type: 'SUMMARIZE_CHUNK_WITH_PROFILE',
        success: true,
        data: {
          summary: summary,
          title: title,
          chunkId: chunkId,
          profileAware: true
        }
      };

    } catch (error) {
      this.log('Profile-aware chunk summarization failed', 'error', { 
        error: error.message,
        chunkId: taskData.chunkId 
      });
      
      const input = taskData.text || '';
      const fallbackOutput = this.localProfileAwareExtraction(input, taskData.profileTopics || []);
      
      return {
        type: 'SUMMARIZE_CHUNK_WITH_PROFILE',
        success: false,
        error: error.message,
        data: {
          summary: fallbackOutput.summary,
          title: fallbackOutput.title,
          chunkId: taskData.chunkId,
          profileAware: false
        }
      };
    }
  }
  

  /**
   * 🆕 GENERATE SUMMARY OF SUMMARIES
   */
  async processSummaryOfSummaries(taskData) {
    this.log('📚 Generating summary of summaries', 'info', {
      chunkCount: taskData.chunkSummaries?.length || 0,
      hasProfile: !!taskData.profileSummary
    });

    try {
      const {
        chunkSummaries,
        profileSummary,
        profileTopics,
        profileFocusStyle
      } = taskData;

      if (!chunkSummaries || chunkSummaries.length === 0) {
        throw new Error('No chunk summaries provided');
      }

      // Combine all chunk summaries
      const combinedSummaries = chunkSummaries
        .map((summary, index) => `[Chunk ${index + 1}]: ${summary.text}`)
        .join('\n\n');

      let comprehensiveSummary = '';

      if (this.summarizerAvailable && this.summarizer) {
        this.log('Using Summarizer API for summary of summaries', 'info');
        
        try {
          const profileContext = this.buildSummaryOfSummariesContext(
            profileSummary,
            profileTopics,
            profileFocusStyle
          );

          // Use longer format for comprehensive summary
          comprehensiveSummary = await this.summarizer.summarize(combinedSummaries, {
            context: profileContext,
            type: 'key-points',
            format: 'plain-text',
            length: 'long' // Use long for comprehensive summary
          });

          this.log('✅ Summary of summaries generated (Summarizer API)', 'info');
          
        } catch (summarizerError) {
          this.log('Summarizer API failed for summary of summaries, using LanguageModel', 'warn', {
            error: summarizerError.message
          });
          comprehensiveSummary = await this.fallbackSummaryOfSummaries(
            combinedSummaries,
            profileSummary,
            profileTopics,
            profileFocusStyle
          );
        }
      } else {
        comprehensiveSummary = await this.fallbackSummaryOfSummaries(
          combinedSummaries,
          profileSummary,
          profileTopics,
          profileFocusStyle
        );
      }

      comprehensiveSummary = this.cleanSummarizerOutput(comprehensiveSummary, { 
        format: 'plain-text', 
        length: 'long' 
      });

      this.log('✅ Summary of summaries completed', 'info', {
        summaryLength: comprehensiveSummary.length,
        inputChunks: chunkSummaries.length
      });

      return {
        type: 'GENERATE_SUMMARY_OF_SUMMARIES',
        success: true,
        data: {
          comprehensiveSummary: comprehensiveSummary,
          chunkCount: chunkSummaries.length,
          profileAware: true
        }
      };

    } catch (error) {
      this.log('Summary of summaries generation failed', 'error', { error: error.message });
      
      // Fallback: combine first sentences from each chunk summary
      const fallbackSummary = taskData.chunkSummaries
        .map((summary, index) => `${index + 1}. ${summary.text.split('.')[0]}.`)
        .join(' ');

      return {
        type: 'GENERATE_SUMMARY_OF_SUMMARIES',
        success: false,
        error: error.message,
        data: {
          comprehensiveSummary: fallbackSummary,
          chunkCount: taskData.chunkSummaries?.length || 0,
          profileAware: false
        }
      };
    }
  }


  /**
 * 🔧 Get summarizer configuration based on profile focus style
 */
getSummarizerConfig(focusStyle) {
  const configs = {
    'focused': {
      type: 'key-points',
      format: 'plain-text',
      length: 'long' 
    },
    'exploratory': {
      type: 'key-points',
      format: 'plain-text',
      length: 'medium' // Quick overview
    },
    'balanced': {
      type: 'key-points',
      format: 'plain-text',
      length: 'medium' // Balanced approach
    }
  };
    
  return configs[focusStyle] || configs['balanced'];
}
  /**
   * 🔧 Build profile context string for AI
   */
  buildProfileContext(profileSummary, profileTopics, profileConfidence, profileFocusStyle) {
    let context = `User Profile: ${profileSummary.substring(0, 600)}`;
    
    
    
    
    
    context += `\n\nTask: Summarize the following content with a focus on the user's interests. Highlight relevant aspects, but retain key context for completeness.`;
    
    return context;
  }

  /**
   * 🔧 Generate smart chunk title based on content and profile
   */
  generateChunkTitle(firstSentence, profileTopics) {
    if (!firstSentence) return 'Content Summary';
    
    let title = firstSentence.trim();
    
    if (profileTopics && profileTopics.length > 0) {
      for (const topic of profileTopics) {
        if (title.toLowerCase().includes(topic.toLowerCase())) {
          const words = title.split(' ');
          const topicIndex = words.findIndex(w => 
            w.toLowerCase().includes(topic.toLowerCase())
          );
          
          if (topicIndex !== -1) {
            const start = Math.max(0, topicIndex - 2);
            const end = Math.min(words.length, topicIndex + 3);
            title = words.slice(start, end).join(' ');
            break;
          }
        }
      }
    }
    
    if (title.length > 60) {
      title = title.substring(0, 60) + '...';
    }
    
    return title;
  }

  /**
   * 🚀 Fallback profile-aware summarization using LanguageModel
   */
  async fallbackProfileAwareSummarization(text, profileSummary, profileTopics, profileFocusStyle) {
    if (!this.languageModel) {
      throw new Error('LanguageModel unavailable for fallback');
    }

    const focusGuidance = this.getFocusStyleGuidance(profileFocusStyle);
    const topicsString = profileTopics && profileTopics.length > 0 
      ? profileTopics.join(', ') 
      : 'general topics';

    const prompt = `
USER PROFILE CONTEXT:
${profileSummary.substring(0, 400)}

USER INTERESTS: ${topicsString}
READING PREFERENCE: ${focusGuidance}

CONTENT TO SUMMARIZE:
${text.substring(0, 3500)}

CRITICAL INSTRUCTIONS:
1. Focus ONLY on content related to: ${topicsString}
2. Ignore information unrelated to the user's interests
3. ${focusGuidance}
4. Return 2-3 concise sentences highlighting what matters to THIS specific user
5. Start with the most relevant insight

Return ONLY the summary text, no labels or explanations.
`;

    try {
      const summary = await this.languageModel.prompt(prompt, {
        responseConstraint: { type: "string", maxLength: 400 },
        omitResponseConstraintInput: true
      });

      const cleaned = this.cleanSummarizerOutput(summary, { format: 'plain-text' });
      
      const sentences = cleaned.split(/[.!?]+/).filter(s => s.trim().length > 0);
      const title = this.generateChunkTitle(sentences[0] || cleaned.substring(0, 60), profileTopics);
      
      return {
        summary: cleaned,
        title: title
      };
      
    } catch (error) {
      this.log('LanguageModel summarization failed', 'error', { error: error.message });
      throw error;
    }
  }

  /**
   * 🔧 Get focus style guidance for prompt
   */
  getFocusStyleGuidance(focusStyle) {
    const guidance = {
      'focused': 'Provide deep, analytical insights. The user prefers detailed exploration of specific topics.',
      'exploratory': 'Highlight diverse connections and broader implications. The user enjoys discovering new perspectives.',
      'balanced': 'Balance depth with breadth. Provide clear insights without overwhelming detail.'
    };
    
    return guidance[focusStyle] || guidance['balanced'];
  }

  /**
   * 🔧 Local profile-aware extraction (final fallback)
   */
  localProfileAwareExtraction(text, profileTopics) {
    if (!text || typeof text !== 'string') {
      return { summary: 'Summary not available.', title: 'Content Summary' };
    }
    
    const sentences = text.split(/[.!?]+/).map(s => s.trim()).filter(Boolean);
    
    const scoredSentences = sentences.map(sentence => {
      let score = 0;
      const lowerSentence = sentence.toLowerCase();
      
      if (profileTopics && profileTopics.length > 0) {
        for (const topic of profileTopics) {
          if (lowerSentence.includes(topic.toLowerCase())) {
            score += 10;
          }
        }
      }
      
      const wordCount = sentence.split(/\s+/).length;
      if (wordCount >= 10 && wordCount <= 25) {
        score += 3;
      }
      
      return { sentence, score };
    });
    
    const topSentences = scoredSentences
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map(item => item.sentence);
    
    const summary = topSentences.join('. ') + '.';
    const title = topSentences[0]?.substring(0, 60) || 'Content Summary';
    
    return { summary, title };
  }

  /**
   * ✨ ENHANCED FINAL INSIGHT GENERATION (Using Summary of Summaries)
   */
async processFinalInsightGeneration(taskData) {
    this.log('✨ Processing final insight generation', 'info', {
      hasProfileSummary: !!taskData.profileSummary,
      hasComprehensiveSummary: !!taskData.comprehensiveSummary,
      chunkCount: taskData.chunkIds?.length || 0
    });

    try {
      const {
        comprehensiveSummary,
        profileSummary,
        profileTopics,
        pageDomain,
        contentDomain,
        chunkIds,
        chunkScores
      } = taskData;

      if (!comprehensiveSummary) {
        throw new Error('comprehensiveSummary is required but was not provided');
      }

      if (!this.languageModel) {
        throw new Error('LanguageModel not available for final insight');
      }

      const prompt = this.buildFinalInsightPrompt(
        comprehensiveSummary,
        profileSummary,
        profileTopics,
        pageDomain,
        contentDomain,
        chunkScores
      );

      const response = await this.languageModel.prompt(prompt, {
        responseConstraint: {
          type: "object",
          properties: {
            headline: { type: "string", maxLength: 120 },
            subheading: { type: "string", maxLength: 120 },
            bullets: { 
              type: "array", 
              items: { type: "string", maxLength: 250 },
              minItems: 3,
              maxItems: 3
            },
            cta: { type: "string", maxLength: 120 },
            bulletSources: {
              type: "array",
              items: { type: "number" },
              minItems: 3,
              maxItems: 3
            }
          },
          required: ["headline", "subheading", "bullets", "cta"],
          additionalProperties: false
        },
        omitResponseConstraintInput: true
      });

      // 🌟 LOG RAW RESPONSE
      this.log('📥 RAW FINAL INSIGHT RESPONSE', 'debug', {
        rawResponse: response,
        responseType: typeof response,
        responseLength: typeof response === 'string' ? response.length : 'non-string'
      });

      let parsed;
      try {
        parsed = typeof response === 'string' ? JSON.parse(response) : response;
        
        // 🌟 LOG PARSED RESPONSE
        this.log('📦 PARSED FINAL INSIGHT RESPONSE', 'debug', {
          parsedResponse: parsed,
          keys: Object.keys(parsed),
          headlineLength: parsed.headline?.length,
          subheadingLength: parsed.subheading?.length,
          bulletsCount: parsed.bullets?.length,
          hasCTA: !!parsed.cta,
          hasBulletSources: !!parsed.bulletSources
        });
        
      } catch (e) {
        this.log('⚠️ JSON PARSE ATTEMPT FAILED, TRYING REGEX EXTRACTION', 'warn', {
          error: e.message,
          rawResponseSample: typeof response === 'string' ? response.substring(0, 200) + '...' : 'non-string response'
        });
        
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          parsed = JSON.parse(jsonMatch[0]);
          
          // 🌟 LOG REGEX-EXTRACTED PARSED RESPONSE
          this.log('🔧 REGEX-EXTRACTED PARSED RESPONSE', 'debug', {
            parsedResponse: parsed,
            extractionMethod: 'regex',
            jsonMatchLength: jsonMatch[0].length
          });
        } else {
          throw new Error('Failed to parse final insight response');
        }
      }

      const insight = this.validateFinalInsight(parsed, chunkIds);

      // 🌟 LOG FINAL VALIDATED INSIGHT
      this.log('✅ FINAL VALIDATED INSIGHT', 'info', {
        headline: insight.headline,
        subheading: insight.subheading,
        bulletCount: insight.bullets.length,
        bulletsPreview: insight.bullets.map(b => b.substring(0, 50) + '...'),
        cta: insight.cta,
        bulletSources: insight.bulletSources
      });

      return {
        type: 'GENERATE_FINAL_INSIGHT',
        success: true,
        data: insight
      };

    } catch (error) {
      this.log('❌ FINAL INSIGHT GENERATION FAILED', 'error', { 
        error: error.message,
        stack: error.stack,
        comprehensiveSummaryLength: taskData.comprehensiveSummary?.length,
        profileSummaryLength: taskData.profileSummary?.length,
        profileTopicsCount: taskData.profileTopics?.length
      });
      
      const fallbackInsight = this.generateFallbackFinalInsight(
        taskData.comprehensiveSummary || taskData.profileAwareSummaries,
        taskData.profileTopics,
        taskData.chunkIds
      );
      
      // 🌟 LOG FALLBACK INSIGHT
      this.log('🔄 USING FALLBACK INSIGHT', 'warn', {
        fallbackHeadline: fallbackInsight.headline,
        fallbackBulletCount: fallbackInsight.bullets?.length || 0
      });
      
      return {
        type: 'GENERATE_FINAL_INSIGHT',
        success: false,
        error: error.message,
        data: fallbackInsight
      };
    }
  }

  /**
   * 🔧 Enhanced final insight prompt using comprehensive summary
   */
  buildFinalInsightPrompt(comprehensiveSummary, profileSummary, profileTopics, pageDomain, contentDomain, chunkScores) {
    const topicsString = profileTopics && profileTopics.length > 0 
      ? profileTopics.join(', ') 
      : 'general interests';

    return `
You are analyzing a comprehensive profile-aware content summary to generate final personalized insights.

USER PROFILE (The Analytical Lens):
${profileSummary.substring(0, 500)}

USER PRIMARY INTERESTS: ${topicsString}

CONTENT CONTEXT:
- Source Domain: ${pageDomain}
- Topic Category: ${contentDomain}

COMPREHENSIVE PROFILE-AWARE SUMMARY (Already synthesized and filtered for user relevance):
${comprehensiveSummary.substring(0, 2500)}

TASK: Create compelling personalized insights that:
1. Extract the most valuable insights from the comprehensive summary above
2. Connect insights explicitly to user's interests: ${topicsString}
3. Highlight actionable takeaways relevant to the user's profile
4. Use engaging language appropriate for this user

OUTPUT STRUCTURE:
{
  "headline": "Specific title connecting ${contentDomain} to ${topicsString} (max 120 chars)",
  "subheading": "Clear analytical angle based on user profile (max 120 chars)",
  "bullets": [
    "First key insight connecting to ${topicsString}",
    "Second insight with actionable takeaway", 
    "Third insight highlighting relevance to user"
  ],
  "cta": "Action-oriented phrase for user (max 120 chars)",
  "bulletSources": [0, 1, 2]
}

CRITICAL RULES:
- Make it PERSONAL to this user's interests
- Be SPECIFIC, not generic  
- Connect content to profile explicitly
- Each bullet must be self-contained insight

Return ONLY valid JSON, no explanations.
`;
  }


  /**
   * 🔧 Validate and sanitize final insight
   */
  validateFinalInsight(parsed, chunkIds) {
    const validated = {
      headline: 'Key Insights for You',
      subheading: 'Personalized analysis based on your profile',
      bullets: ['Key insight 1', 'Key insight 2', 'Key insight 3'],
      cta: 'Explore more',
      bulletSources: chunkIds.slice(0, 3)
    };

    if (parsed.headline && typeof parsed.headline === 'string') {
      validated.headline = parsed.headline.substring(0, 120);
    }

    if (parsed.subheading && typeof parsed.subheading === 'string') {
      validated.subheading = parsed.subheading.substring(0, 120);
    }

    if (Array.isArray(parsed.bullets)) {
      validated.bullets = parsed.bullets
        .slice(0, 3)
        .filter(bullet => typeof bullet === 'string')
        .map(bullet => bullet.substring(0, 250));
      
      while (validated.bullets.length < 3) {
        validated.bullets.push(`Insight ${validated.bullets.length + 1}`);
      }
    }

    if (parsed.cta && typeof parsed.cta === 'string') {
      validated.cta = parsed.cta.substring(0, 120);
    }

    if (Array.isArray(parsed.bulletSources) && parsed.bulletSources.length >= 3) {
      validated.bulletSources = parsed.bulletSources.slice(0, 3);
    }

    return validated;
  }

  /**
   * 🔧 Generate fallback final insight
   */
  generateFallbackFinalInsight(summaries, profileTopics, chunkIds) {
    const topicsString = profileTopics && profileTopics.length > 0
      ? profileTopics.join(' and ')
      : 'your interests';

    const sentences = summaries
      .split(/[.!?]+/)
      .map(s => s.trim())
      .filter(s => s.length >= 30 && s.length <= 150)
      .slice(0, 3);

    return {
      headline: `Key insights on ${topicsString}`,
      subheading: 'Analysis based on your personal profile',
      bullets: sentences.length >= 3 
        ? sentences 
        : [
            `Content related to ${topicsString}`,
            'Key findings from the analyzed material',
            'Relevant insights for further exploration'
          ],
      cta: 'Discover more tailored content',
      bulletSources: chunkIds.slice(0, 3)
    };
  }


  // ==================== 🔧 ENHANCED SUMMARIZER HELPER METHODS ====================

  /**
   * 🔧 Generate chunk title using Summarizer API headline type
   */
  async generateChunkTitleWithSummarizer(text, profileContext) {
    if (!this.summarizerAvailable || !this.summarizer) {
      return this.generateChunkTitleFallback(text);
    }
console.log(`title generation `);
    try {
      // Create a dedicated headline summarizer for title generation
      const headlineSummarizer = await Summarizer.create({
        type: 'headline',
        format: 'plain-text',
        length: 'medium', // 17 words max
        expectedInputLanguages: ['en'],
        outputLanguage: 'en'
      });

      const title = await headlineSummarizer.summarize(text, {
        context: profileContext
      });

      return this.cleanTitle(title);
    } catch (error) {
      this.log('Headline summarizer failed, using fallback', 'warn', { error: error.message });
      return this.generateChunkTitleFallback(text);
    }
  }
  /**
   * 🔧 Build enhanced profile context for summary of summaries
   */
  buildSummaryOfSummariesContext(profileSummary, profileTopics, profileFocusStyle) {
    const topicsString = profileTopics && profileTopics.length > 0 
      ? profileTopics.join(', ') 
      : 'general topics';

    return `
USER PROFILE CONTEXT:
${profileSummary.substring(0, 400)}

USER PRIMARY INTERESTS: ${topicsString}
READING PREFERENCE: ${this.getFocusStyleGuidance(profileFocusStyle)}

TASK: Summarize the following chunk summaries with a focus on the user's interests, while preserving any essential context needed to understand the key points.

Create a comprehensive summary that:
1. Synthesizes information from all chunks
2. Highlights connections between different pieces of information
3. Maintains focus on topics relevant to the user: ${topicsString}
4. Provides a coherent overview of the entire content

Return a well-structured summary that flows naturally.
`;
  }


    /**
   * 🔧 Fallback for summary of summaries using LanguageModel
   */
  async fallbackSummaryOfSummaries(combinedSummaries, profileSummary, profileTopics, profileFocusStyle) {
    if (!this.languageModel) {
      throw new Error('LanguageModel unavailable for fallback');
    }

    const topicsString = profileTopics && profileTopics.length > 0 
      ? profileTopics.join(', ') 
      : 'general topics';

    const prompt = `
USER PROFILE CONTEXT:
${profileSummary.substring(0, 400)}

USER PRIMARY INTERESTS: ${topicsString}
READING PREFERENCE: ${this.getFocusStyleGuidance(profileFocusStyle)}

CHUNK SUMMARIES TO SYNTHESIZE:
${combinedSummaries.substring(0, 6000)}

TASK: Create a comprehensive summary that synthesizes all the chunk summaries above. 
Focus on the user's interests (${topicsString}) while preserving essential context.

Requirements:
- Create a coherent, flowing summary (not bullet points)
- Connect related information from different chunks
- Emphasize content relevant to: ${topicsString}
- Maintain overall context and key relationships
- Keep it comprehensive but focused

Return ONLY the synthesized summary text.
`;

    try {
      const summary = await this.languageModel.prompt(prompt, {
        responseConstraint: { type: "string", maxLength: 1500 },
        omitResponseConstraintInput: true
      });

      return this.cleanSummarizerOutput(summary, { format: 'plain-text', length: 'long' });
    } catch (error) {
      this.log('LanguageModel summary of summaries failed', 'error', { error: error.message });
      throw error;
    }
  }

 
 
 
  /**
   * 🔧 Clean and format title
   */
  cleanTitle(title) {
    if (!title) return 'Content Summary';
    
    let cleaned = title.trim();
    
    // Remove quotes and extra spaces
    cleaned = cleaned.replace(/^["']|["']$/g, '').trim();
    
    // Ensure it's not too long
    if (cleaned.length > 80) {
      cleaned = cleaned.substring(0, 77) + '...';
    }
    
    // Capitalize first letter
    cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
    
    return cleaned;
  }

  /**
   * 🔧 Fallback title generation
   */
  generateChunkTitleFallback(text) {
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
    const firstSentence = sentences[0] || text.substring(0, 100);
    
    let title = firstSentence.trim();
    
    if (title.length > 60) {
      const words = title.split(' ');
      if (words.length > 8) {
        title = words.slice(0, 8).join(' ') + '...';
      } else {
        title = title.substring(0, 57) + '...';
      }
    }
    
    return this.cleanTitle(title);
  }

 
 
 
 
 
 
 
 
  // ==================== EXISTING TASK PROCESSING METHODS ====================
  // (Keeping these for backward compatibility and other functionality)

  async processSearchEnrichment(taskData) {
    this.log('Processing search enrichment task', 'info', { query: taskData.query });
    try{
      const result = await this.analyzeSearchQuery(taskData.query);
      if (result.success && result.data) {
        const dbCompatibleData = {
          ...result.data,
          topicDomain: result.data.topicDomains.map(td => td.topic).join(', ')
        };
        await this.updateSearchInDatabase(taskData.query, dbCompatibleData);
      }
      return {
        analysis: result.success ? result.data : result,
        success: result.success !== false,
        databaseUpdated: result.success,
        originalQuery: taskData.query
      };
    } catch(error) {
      this.log('Search enrichment processing failed', 'error', { error: error.message });
      return {
        analysis: null,
        success: false,
        error: error.message,
        originalQuery: taskData.query
      };
    }
  }

  async processPageAnalysis(taskData) {
    this.log('Processing page analysis task', 'info');
    
    try {
      const contentData = taskData;
      
      if (!contentData || Object.keys(contentData).length === 0) {
        throw new Error('No content data provided for page analysis');
      }

      const analysis = await this.analyzePageRelevance(contentData);
      
      return {
        analysis: analysis,
        relevanceScore: analysis.relevanceScore,
        keyTopics: analysis.keyTopics,
        contentType: analysis.contentType,
        confidence: analysis.confidence || 0.7,
        success: true
      };
      
    } catch (error) {
      this.log('Page analysis processing failed', 'error', { error: error.message });
      
      const fallback = this.fallbackPageAnalysis(taskData);
       return {
        analysis: fallback,
        relevanceScore: fallback.relevanceScore,
        keyTopics: fallback.keyTopics,
        contentType: fallback.contentType,
        success: false,
        error: error.message
      };
    }
  }

  async processHighlightExtraction(taskData) {
    this.log('Processing highlight extraction task', 'info');

    try {
      const { pageAnalysis, source } = taskData;
      
      if (!source || typeof source !== 'string') {
        throw new Error('Invalid source content for highlight extraction');
      }

      let highlights = [];

      if (this.languageModel) {
        highlights = await this.aiHighlightExtraction(source, pageAnalysis);
      }

      if (!highlights || highlights.length < 2) {
        const fallbackHighlights = this.localHighlightExtraction(source, pageAnalysis);
        highlights = highlights ? [...highlights, ...fallbackHighlights] : fallbackHighlights;
      }

      highlights = this.deduplicateHighlights(highlights).slice(0, 6);

      const enhancedHighlights = highlights.map((text, index) => ({
        id: index + 1,
        text: text,
        domHint: this.generateDomHint(text)
      }));

      this.log('Highlight extraction completed', 'info', {
        highlightCount: enhancedHighlights.length
      });

      return {
        success: true,
        highlights: enhancedHighlights
      };

    } catch (error) {
      this.log('Highlight extraction failed', 'error', { error: error.message });
      
      const source = taskData.source || '';
      const pageAnalysis = taskData.pageAnalysis;
      
      const fallbackHighlights = this.localHighlightExtraction(source, pageAnalysis)
        .slice(0, 3).map((text, index) => ({ id: index + 1, text: text, domHint: null }));
        
      return {
        success: false,
        error: error.message,
        highlights: fallbackHighlights,
        usedFallback: true
      };
    }
  }

  async processSummarizerCall(taskData) {
    this.log('Processing summarizer call task', 'info', {
      taskDataKeys: Object.keys(taskData),
      dataKeys: taskData.data ? Object.keys(taskData.data) : 'no data'
    });

    try {
      const taskDataInput = taskData || taskData.data?.data;
      
      if (!taskDataInput) {
        throw new Error('No input data provided for summarizer');
      }

      const { input, options = {}, profileHint = '' } = taskDataInput;
      
      if (!input || typeof input !== 'string') {
        throw new Error('Invalid input for summarizer: ' + typeof input);
      }

      let summarizerOutput = '';

      if (this.summarizerAvailable && this.summarizer) {
        this.log('Using native Summarizer API', 'info');
        
        try {
          const context = profileHint ? `Profile: ${profileHint.substring(0, 300)}` : '';
          
          summarizerOutput = await this.summarizer.summarize(input, {
            context: context,
            type: options.type || 'key-points',
            format: options.format || 'plain-text',
            length: options.length || 'short'
          });

          summarizerOutput = this.cleanSummarizerOutput(summarizerOutput, options);
          
        } catch (summarizerError) {
          this.log('Summarizer API failed, falling back to LanguageModel', 'warn', {
            error: summarizerError.message
          });
          summarizerOutput = await this.fallbackSummarizerCall(input, profileHint, options);
        }
      } else {
        summarizerOutput = await this.fallbackSummarizerCall(input, profileHint, options);
      }

      this.log('Summarizer call completed', 'info', {
        outputLength: summarizerOutput.length,
        outputPreview: summarizerOutput.substring(0, 100)
      });

      return {
        type: 'SUMMARIZER_CALL',
        success: true,
        data: {
          summarizerOutput: summarizerOutput,
          usedFallback: !(this.summarizerAvailable && this.summarizer)
        }
      };

    } catch (error) {
      this.log('Summarizer call failed', 'error', { error: error.message });
      
      const input = taskData.data?.data?.input || taskData.data?.input || '';
      const fallbackOutput = this.localConciseExtraction(input);
      
      return {
        type: 'SUMMARIZER_CALL',
        success: false,
        error: error.message,
        data: {
          summarizerOutput: fallbackOutput,
          usedFallback: true,
          usedLocalFallback: true
        }
      };
    }
  }

  async processPromptApiCall(taskData) {
    this.log('Processing prompt API call task', 'info', {
      taskDataKeys: Object.keys(taskData),
      hasData: !!taskData.data
    });

    try {
      const taskDataInput = taskData;
      
      if (!taskDataInput) {
        throw new Error('No prompt data provided for API call');
      }

      const { prompt, profileHint = '' } = taskDataInput;
      
      if (!prompt || typeof prompt !== 'string') {
        throw new Error('Invalid prompt for API call: ' + typeof prompt);
      }

      if (!this.languageModel) {
        throw new Error('LanguageModel unavailable for prompt API call');
      }

      const enhancedPrompt = `
You are a personalization assistant. Return ONLY a single JSON object with these keys: headline, subheading, bullets, cta. 
Values must be plain text strings (bullets is an array of exactly 3 strings). 
Keep each text <= 120 characters. Tone: curious and engaging. 
No surrounding commentary, no code fences.

${prompt.substring(0, 4000)}
`;

      const response = await this.languageModel.prompt(enhancedPrompt, {
        responseConstraint: {
          type: "object",
          properties: {
            headline: { type: "string", maxLength: 120 },
            subheading: { type: "string", maxLength: 120 },
            bullets: { 
              type: "array", 
              items: { type: "string", maxLength: 120 },
              minItems: 3,
              maxItems: 3
            },
            cta: { type: "string", maxLength: 120 }
          },
          required: ["headline", "subheading", "bullets", "cta"],
          additionalProperties: false
        },
        omitResponseConstraintInput: true
      });

      let parsedResponse;
      try {
        parsedResponse = typeof response === 'string' ? JSON.parse(response) : response;
        parsedResponse = this.validateAndSanitizePromptResponse(parsedResponse);
        
      } catch (parseError) {
        this.log('Failed to parse prompt response, attempting recovery', 'warn', {
          response: response?.substring(0, 200),
          error: parseError.message
        });
        
        parsedResponse = this.extractAndParseJSON(response);
      }

      this.log('Prompt API call completed', 'info', {
        headline: parsedResponse.headline,
        bulletsCount: parsedResponse.bullets?.length
      });

      return {
        type: 'PROMPT_API_CALL',
        success: true,
        data: {
          composerRaw: response,
          composerParsed: parsedResponse,
          usedFallback: false
        }
      };

    } catch (error) {
      this.log('Prompt API call failed', 'error', { error: error.message });
      
      const prompt = taskData.data?.data?.prompt || taskData.data?.prompt || '';
      const fallbackResponse = this.generateFallbackPromptResponse(prompt);
      
      return {
        type: 'PROMPT_API_CALL',
        success: false,
        error: error.message,
        data: {
          composerRaw: null,
          composerParsed: fallbackResponse,
          usedFallback: true
        }
      };
    }
  }

  async processTopicInference(taskData) {
    this.log('Processing topic inference with weighted topic domains', 'info', { 
      recordId: taskData.recordId,
      domain: taskData.domain,
      contentLength: taskData.contentSample?.length 
    });
     
    let topicDomains = [{ topic: this.MASTER_TOPIC_BUCKET.UNKNOWN, weight: 1.0 }];
    let success = false;

    try {
      if (!this.languageModel) {
        throw new Error('Language Model unavailable');
      }

      const prompt = `
        Analyze the following content sample and determine the main topic domains with their relative importance.
        
        Content Sample:
        ${taskData.contentSample.substring(0, 3000)}
        
        Return a JSON object with "topicDomains" array containing 1-3 objects, each with:
        - "topic": exact topic name from this predefined list: ${this.TOPIC_DOMAIN_ENUM.join(', ')}
        - "weight": number between 0.0 and 1.0 indicating relative importance
        
        IMPORTANT:
        - Choose 1-3 most relevant topics from the predefined list
        - Weights must be between 0.0 and 1.0, and the sum of all weights must equal 1.0
        - Only include topics that are actually present in the content
        - If the content doesn't clearly match any topic, use "${this.MASTER_TOPIC_BUCKET.UNKNOWN}" with weight 1.0
        
        Only output valid JSON without any additional text.
      `;

      const response = await this.languageModel.prompt(prompt, {
        responseConstraint: this.TOPIC_INFERENCE_SCHEMA,
        omitResponseConstraintInput: true
      });

      let result;
      try {
        let cleanedResponse = response.trim();
        cleanedResponse = cleanedResponse.replace(/^\s*```(json)?\s*|\s*```\s*$/g, '').trim();
        result = JSON.parse(cleanedResponse);
        
        topicDomains = this.validateAndNormalizeTopicWeights(result.topicDomains);
        
        if (topicDomains.length === 0) {
          throw new Error('No valid topic domains found');
        }
        
        success = true;
        this.log('Topic inference completed with weighted topics', 'info', { 
          recordId: taskData.recordId,
          topicDomains: topicDomains 
        });
        
      } catch (parseError) {
        throw new Error(`Failed to parse topic inference response: ${parseError.message}`);
      }

    } catch (error) {
      this.log('Topic inference failed', 'error', { 
        error: error.message,
        recordId: taskData.recordId 
      });
      topicDomains = [{ topic: this.MASTER_TOPIC_BUCKET.UNKNOWN, weight: 1.0 }];
      success = false;
    }

    try {
      const dbResult = await this.updateTopicDomainsInDatabase(
        taskData.recordId, 
        topicDomains,
        taskData.queueTaskId
      );
      
      if (!dbResult.success) {
        this.log('Failed to update topic domains in database', 'error', {
          recordId: taskData.recordId,
          error: dbResult.error
        });
      }
    } catch (dbError) {
      this.log('Database update failed', 'error', {
        recordId: taskData.recordId,
        error: dbError.message
      });
    }

    return {
      success: success,
      topicDomains: topicDomains,
      primaryTopic: topicDomains[0].topic,
      recordId: taskData.recordId
    };
  }

  async processProfileSummaryGeneration(taskData) {
    this.log('Starting sequential profile summary generation', 'info');
    
    try {
        if (!this.languageModel) {
            throw new Error('Language Model not available for summary generation');
        }

        if (!this.backgroundService || !this.backgroundService.dbService) {
            throw new Error('Background service or database service not available');
        }

        const ltp = await this.backgroundService.dbService.getLTP();
        const lastSTP = await this.backgroundService.dbService.getLastSTP();
        
        this.log('Retrieved data for summary generation', 'info', {
            hasLTP: !!ltp,
            ltpSessions: ltp?.sessions_seen || 0,
            hasSTP: !!lastSTP
        });

        if (!ltp || ltp.sessions_seen === 0) {
            this.log('No LTP data available for summary generation', 'warn');
            const fallbackSummary = this.generateFallbackSummary();
            await this.backgroundService.dbService.saveCombinedProfileSummary(
                fallbackSummary.combinedSummary,
                fallbackSummary.ltpSummary,
                fallbackSummary.stpSummary
            );
            return {
                success: true,
                summary: fallbackSummary,
                usedFallback: true
            };
        }

        this.log('Step 1: Generating LTP summary...', 'info');
        const ltpSummary = await this.generateLTPSummary(ltp);
        await this.backgroundService.dbService.saveLTPSummary(ltpSummary);
        this.log('✅ LTP summary generated and stored', 'info');

        this.log('Step 2: Generating STP summary...', 'info');
        const stpSummary = await this.generateSTPSummary(lastSTP);
        await this.backgroundService.dbService.saveSTPSummary(stpSummary);
        this.log('✅ STP summary generated and stored', 'info');

        this.log('Step 3: Generating combined profile summary...', 'info');
        const combinedSummary = await this.generateCombinedSummary(ltpSummary, stpSummary);
        
        await this.backgroundService.dbService.saveCombinedProfileSummary(
            combinedSummary, 
            ltpSummary, 
            stpSummary
        );

        this.log('🎉 Profile summary generation completed successfully', 'info', {
            ltpSessions: ltp.sessions_seen,
            hasSTP: !!lastSTP,
            confidence: ltp.confidence
        });

        return {
            success: true,
            summary: {
                combinedSummary: combinedSummary,
                ltpSummary: ltpSummary,
                stpSummary: stpSummary
            }
        };

    } catch (error) {
        this.log('Profile summary generation failed', 'error', { error: error.message });
        
        const fallbackSummary = this.generateFallbackSummary();
        try {
            await this.backgroundService.dbService.saveCombinedProfileSummary(
                fallbackSummary.combinedSummary,
                fallbackSummary.ltpSummary,
                fallbackSummary.stpSummary
            );
        } catch (dbError) {
            this.log('Failed to save fallback summary', 'error', { error: dbError.message });
        }
        
        return {
            success: false,
            error: error.message,
            summary: fallbackSummary
        };
    }
  }

  // ==================== HELPER METHODS ====================

  cleanSummarizerOutput(output, options) {
    if (!output || typeof output !== 'string') return '';
    
    let cleaned = output.trim();
    
    if (options.format === 'plain-text') {
      cleaned = cleaned
        .replace(/^\s*[-*•]\s*/gm, '')
        .replace(/\*\*(.*?)\*\*/g, '$1')
        .replace(/\*(.*?)\*/g, '$1')
        .replace(/`(.*?)`/g, '$1');
    }
    
    const maxLength = options.length === 'short' ? 500 : 800;
    if (cleaned.length > maxLength) {
      cleaned = cleaned.substring(0, maxLength - 3) + '...';
    }
    
    return cleaned;
  }

  async fallbackSummarizerCall(input, profileHint, options) {
    if (!this.languageModel) {
      throw new Error('LanguageModel unavailable for fallback summarization');
    }

    const prompt = `
    ${profileHint ? `Profile Context: ${profileHint.substring(0, 300)}` : ''}
    
    Content to summarize:
    ${input.substring(0, 6000)}
    
    Task: Create a ${options.length || 'short'} ${options.type || 'key-points'} summary.
    ${options.type === 'key-points' ? 'Return 3-5 bullet points as plain text.' : 'Return 1-3 concise sentences.'}
    Focus on the most relevant information for the user profile.
    
    Return only the summary text, no explanations or labels.
    `;

    const response = await this.languageModel.prompt(prompt, {
      responseConstraint: { type: "string", maxLength: 800 },
      omitResponseConstraintInput: true
    });

    return this.cleanSummarizerOutput(response, options);
  }

  localConciseExtraction(input) {
    if (!input || typeof input !== 'string') return 'Summary not available.';
    
    const sentences = input.split(/[.!?]+/).map(s => s.trim()).filter(Boolean);
    const keySentences = sentences.slice(0, 3).map(s => 
      s.length > 100 ? s.substring(0, 100) + '...' : s
    );
    
    return keySentences.join('. ') + '.';
  }

  validateAndSanitizePromptResponse(response) {
    const validated = {
      headline: 'Explore insights',
      subheading: 'Personalized content summary',
      bullets: ['Key point 1', 'Key point 2', 'Key point 3'],
      cta: 'Show me more'
    };

    if (response.headline && typeof response.headline === 'string') {
      validated.headline = response.headline.substring(0, 120);
    }

    if (response.subheading && typeof response.subheading === 'string') {
      validated.subheading = response.subheading.substring(0, 120);
    }

    if (Array.isArray(response.bullets)) {
      validated.bullets = response.bullets
        .slice(0, 3)
        .filter(bullet => typeof bullet === 'string')
        .map(bullet => bullet.substring(0, 120));
      
      while (validated.bullets.length < 3) {
        validated.bullets.push(`Key point ${validated.bullets.length + 1}`);
      }
    }

    if (response.cta && typeof response.cta === 'string') {
      validated.cta = response.cta.substring(0, 120);
    }

    return validated;
  }

  extractAndParseJSON(response) {
    if (!response || typeof response !== 'string') {
      return this.generateFallbackPromptResponse();
    }

    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return this.validateAndSanitizePromptResponse(parsed);
      }
    } catch (e) {
      // Continue to fallback
    }

    return this.generateFallbackPromptResponse(response);
  }

  generateFallbackPromptResponse(prompt = '') {
    const hasTech = prompt.toLowerCase().includes('tech') || prompt.toLowerCase().includes('ai');
    const hasBusiness = prompt.toLowerCase().includes('business') || prompt.toLowerCase().includes('market');
    
    const topics = hasTech ? 'technology trends' : hasBusiness ? 'market insights' : 'key topics';
    
    return {
      headline: `Explore ${topics} today`,
      subheading: 'Personalized insights based on your interests and current content',
      bullets: [
        `Relevant ${topics} matched to your profile`,
        'Key findings from the analyzed content',
        'Actionable insights for further exploration'
      ],
      cta: 'Show me tailored reads'
    };
  }

  async generateLTPSummary(ltp) {
    const prompt = `
    Analyze this Long-Term Profile (LTP) data of a user as an expert profiler engine in world and create a concise 2-3 sentence summary within strictly 500 chars focusing ONLY on established patterns:

    PRIMARY INTERESTS: ${Object.keys(ltp.topic_cumulative || {}).slice(0, 5).join(', ')}
    ENGAGEMENT STYLE: ${ltp.ewma_focus > 0.7 ? 'Highly focused' : ltp.ewma_focus < 0.3 ? 'Exploratory' : 'Balanced'}
    DEPTH PREFERENCE: ${ltp.ewma_depth > 0.7 ? 'Deep analytical' : ltp.ewma_depth < 0.3 ? 'Broad overview' : 'Balanced'}
    SESSIONS ANALYZED: ${ltp.sessions_seen}
    CONFIDENCE: ${(ltp.confidence * 100).toFixed(0)}%

    Focus on:
    - Most consistent interests over time
    - Learning and engagement patterns
    - Content depth preferences
    - Any strong behavioral tendencies

    Return ONLY the summary text, no explanations or labels.
    `;

    try {
      const response = await this.languageModel.prompt(prompt, {
        responseConstraint: { type: "string", maxLength: 500 },
        omitResponseConstraintInput: true
      });
      return response.trim();
    } catch (error) {
      this.log('LTP summary generation failed, using fallback', 'warn');
      const interests = ltp.topic_cumulative ? Object.keys(ltp.topic_cumulative).slice(0, 3).join(', ') : 'various topics';
      return `User shows long-term interest in ${interests} with ${ltp.sessions_seen} sessions analyzed. Engagement style is ${ltp.ewma_focus > 0.7 ? 'focused' : 'exploratory'}.`;
    }
  }

  async generateSTPSummary(stp) {
    if (!stp || !stp.session_id) {
      return "Currently establishing session patterns. Recent activity being analyzed.";
    }

    const prompt = `
    Analyze this Short-Term Profile (STP) from the CURRENT session and create a brief 1-2 sentence summary strictly within 300 chars:

    CURRENT FOCUS: ${stp.dominant_topic || 'General browsing'}
    ENGAGEMENT LEVEL: ${(stp.engagement_confidence * 100).toFixed(0)}%
    INTENT FOCUS: ${stp.intent_focus || 'Informational'}
    DIVERSITY: ${(stp.diversity_entropy * 100).toFixed(0)}% varied

    Focus on:
    - What the user is doing RIGHT NOW
    - Immediate interests and goals
    - Session engagement quality
    - Any notable current behaviors

    Return ONLY the summary text, no explanations or labels.
    Keep it very current and immediate.
    `;

    try {
      const response = await this.languageModel.prompt(prompt, {
        responseConstraint: { type: "string", maxLength: 300 },
        omitResponseConstraintInput: true
      });
      return response.trim();
    } catch (error) {
      this.log('STP summary generation failed, using fallback', 'warn');
      return `Currently focused on ${stp.dominant_topic || 'general browsing'} with ${(stp.engagement_confidence * 100).toFixed(0)}% engagement.`;
    }
  }

  async generateCombinedSummary(ltpSummary, stpSummary) {
    const prompt = `
    You are an expert profile generation engine with great track record i want you to Create a comprehensive user profile summary by COMBINING these two pre-generated summaries we want to know the user back and forth via this summary and we will be using this summary as a lens to give a personalized summary of a webpage based on this profile so give it accordingly as well:

    LONG-TERM PATTERNS (LTP Summary):
    "${ltpSummary}"

    CURRENT ACTIVITY (STP Summary):
    "${stpSummary}"

    Create a 3-4 sentence combined summary that:
    1. Starts with established long-term patterns
    2. Notes how current activity relates to those patterns
    3. Highlights interesting alignments or deviations
    4. Provides overall insight for content personalization
    5. is within 600 chars limit

    Focus on creating a cohesive narrative that connects long-term behavior with current activity.
    Return ONLY the final combined summary text.
    `;

    try {
      const response = await this.languageModel.prompt(prompt, {
        responseConstraint: { type: "string", maxLength: 600 },
        omitResponseConstraintInput: true
      });
      return response.trim();
    } catch (error) {
      this.log('Combined summary generation failed, using fallback', 'warn');
      return `${ltpSummary} ${stpSummary} Combined profile provides insights for personalized content delivery.`;
    }
  }

  generateFallbackSummary() {
    return {
      combinedSummary: "User profile analysis is being optimized. Personalization will improve as more behavioral data is collected across sessions.",
      ltpSummary: "Long-term pattern analysis in progress. Establishing baseline behavior patterns.",
      stpSummary: "Current session analysis underway. Tracking immediate interests and engagement."
    };
  }

  validateAndNormalizeTopicWeights(topicDomains) {
    if (!Array.isArray(topicDomains) || topicDomains.length === 0) {
      return [{ topic: this.MASTER_TOPIC_BUCKET.UNKNOWN, weight: 1.0 }];
    }

    const validTopics = topicDomains
      .filter(item => 
        item && 
        typeof item === 'object' &&
        typeof item.topic === 'string' &&
        this.TOPIC_DOMAIN_ENUM.includes(item.topic) &&
        typeof item.weight === 'number' &&
        !isNaN(item.weight)
      )
      .map(item => ({
        topic: item.topic,
        weight: Math.max(0, item.weight)
      }));

    if (validTopics.length === 0) {
      return [{ topic: this.MASTER_TOPIC_BUCKET.UNKNOWN, weight: 1.0 }];
    }

    const totalWeight = validTopics.reduce((sum, item) => sum + item.weight, 0);
    
    if (totalWeight > 0) {
      return validTopics.map(item => ({
        topic: item.topic,
        weight: parseFloat((item.weight / totalWeight).toFixed(3))
      }));
    } else {
      const equalWeight = parseFloat((1.0 / validTopics.length).toFixed(3));
      return validTopics.map(item => ({
        topic: item.topic,
        weight: equalWeight
      }));
    }
  }

  async updateSearchInDatabase(query, analysis) {
    try {
      if (!this.dbService) {
        this.log('Database service not available for search update', 'error');
        return;
      }

      const enrichmentData = {
        query: query,
        enrichment: {
          intentType: analysis.intentType,
          topicDomains: analysis.topicDomains,
          confidence: analysis.confidence,
          specificity: analysis.specificity,
          aiModelUsed: analysis.modelUsed || 'gemini-nano',
          processed: true,
          processedAt: new Date().toISOString()
        },
        enrichedAt: new Date().toISOString()
      };
      
      const result = await this.dbService.enrichSearchesByQuery(
        enrichmentData.query, 
        enrichmentData.enrichment, 
        enrichmentData.enrichedAt
      );
      
      if (result && result.success) {
        this.log('Search successfully updated in database with weighted topics', 'info', { 
          query,
          topicDomains: analysis.topicDomains 
        });
      } else {
        throw new Error(result?.error || 'Database update failed');
      }
      
    } catch (error) {
      this.log('Failed to update search in database', 'error', { error: error.message });
    }
  }

  async updateTopicDomainsInDatabase(recordId, topicDomains, queueTaskId = null) {
    try {
      if (!this.backgroundService || !this.backgroundService.dbService) {
        throw new Error('Database service not available');
      }

      const result = await this.backgroundService.dbService.updateTopicDomains(
        recordId,
        topicDomains,
        queueTaskId
      );

      return result;
    } catch (error) {
      this.log('Failed to update topic domains in database', 'error', {
        recordId,
        error: error.message
      });
      return { success: false, error: error.message };
    }
  }

  async analyzeSearchQuery(query) {
    if (!this.languageModel) {
      this.log('Language Model not available for search analysis', 'warn');
      return { success: true, data: this.fallbackSearchAnalysis(query) };
    }
    
    if (!query || typeof query !== 'string' || query.trim().length === 0) {
      this.log('Invalid query for analysis', 'warn');
      return { success: true, data: this.fallbackSearchAnalysis(query || '') };
    }

    const trimmedQuery = query.trim();
    this.log('Starting search query enrichment with weighted topic domains', 'info', { query: trimmedQuery });

    const promptText = `
      Analyze the search query: "${trimmedQuery}"
      
      Return a JSON object with the following structure:
      - intentType: one of "informational", "transactional", "instructional", "navigational"
      - topicDomains: array of 1-2 objects, each with "topic" (from predefined list) and "weight" (0.0-1.0)
      - confidence: number between 0.0 and 1.0 indicating confidence in the analysis
      - specificity: number between 0.0 and 1.0 indicating how specific the query is
      
      IMPORTANT: 
      - For topicDomains, choose 1-2 most relevant topics from this list: ${this.TOPIC_DOMAIN_ENUM.join(', ')}
      - Weights must be between 0.0 and 1.0, and the sum of all weights must equal 1.0
      - Only include topics that are actually relevant to the query
      
      Only output valid JSON without any additional text, explanations, or markdown formatting.
    `;

    try {
      const response = await this.languageModel.prompt(promptText, {
        responseConstraint: this.SEARCH_ANALYSIS_SCHEMA,
        omitResponseConstraintInput: true
      });

      let analysis;
      try {
        let cleanedResponse = response.trim();
        cleanedResponse = cleanedResponse.replace(/^\s*```(json)?\s*|\s*```\s*$/g, '').trim();
        analysis = JSON.parse(cleanedResponse);
        
        analysis.topicDomains = this.validateAndNormalizeTopicWeights(analysis.topicDomains);
        
        if (!this.validateSearchAnalysisResult(analysis)) {
          throw new Error('Parsed data does not meet schema constraints');
        }
        
      } catch (parseError) {
        this.log('Failed to parse AI response, using fallback', 'warn', {
          response: response?.substring(0, 200),
          error: parseError.message
        });
        return { 
          success: true, 
          data: this.fallbackSearchAnalysis(trimmedQuery),
          usedFallback: true
        };
      }

      this.log('Search analysis completed with weighted topics', 'info', analysis);
      return { 
        success: true, 
        data: analysis 
      };

    } catch (error) {
      this.log('Search analysis API call failed, using fallback', 'error', { 
        error: error.message,
        query: trimmedQuery
      });
      
      return { 
        success: true, 
        data: this.fallbackSearchAnalysis(trimmedQuery),
        usedFallback: true,
        error: error.message
      };
    }
  }

  async analyzePageRelevance(contentData) {
    this.log('Starting enhanced page relevance analysis', 'info');
    
    const profileSummary = await this.getProfileSummary();
    
    if (!this.languageModel) {
      this.log('Using fallback analysis (LanguageModel unavailable)', 'warn');
      return this.fallbackPageAnalysis(contentData);
    }

    const userTaskPrompt = `
    Analyze the following page content for relevance to the user's comprehensive profile.
    
    USER PROFILE SUMMARY:
    ${profileSummary.combinedSummary?.substring(0, 400) || "No profile data available"}
    
    CONTENT TO ANALYZE:
    Title: ${contentData.title}
    Description: ${contentData.metaDescription}
    Headings: ${JSON.stringify(contentData.headings)}
    Content Sample: ${contentData.contentSample?.substring(0, 3000)}
    
    Return a JSON object with:
    - relevanceScore: number between 0.0 and 1.0
    - keyTopics: array of 1-3 topic domains from: ${this.TOPIC_DOMAIN_ENUM.join(', ')}
    - contentType: "educational", "news", "technical", "commercial", or "general"
    - confidence: number between 0.0 and 1.0 indicating analysis confidence

    Only output valid JSON without any additional text.
    `;

    try {
      const response = await this.languageModel.prompt(userTaskPrompt, {
        responseConstraint: {
          type: "object",
          properties: {
            relevanceScore: { type: "number", minimum: 0.0, maximum: 1.0 },
            keyTopics: { 
              type: "array", 
              items: { type: "string", enum: this.TOPIC_DOMAIN_ENUM },
              minItems: 1,
              maxItems: 3
            },
            contentType: { 
              type: "string", 
              enum: ["educational", "news", "technical", "commercial", "general"] 
            },
            confidence: { type: "number", minimum: 0.0, maximum: 1.0 }
          },
          required: ["relevanceScore", "keyTopics", "contentType", "confidence"],
          additionalProperties: false
        },
        omitResponseConstraintInput: true
      });

      const analysis = typeof response === 'string' ? JSON.parse(response) : response;
      
      analysis.relevanceScore = this.adjustRelevanceWithProfile(
        analysis.relevanceScore, 
        profileSummary
      );
      
      this.log('Enhanced page relevance analysis completed', 'info', analysis);
      return analysis;
    } catch (error) {
      this.log('Enhanced page analysis failed, using fallback', 'error');
      return this.fallbackPageAnalysis(contentData);
    }
  }

  async getProfileSummary() {
    try {
      if (!this.backgroundService) {
        return { combinedSummary: "No profile data available" };
      }
      
      const summary = await this.backgroundService.getProfileSummary();
      return summary || { combinedSummary: "No profile data available" };
    } catch (error) {
      this.log('Failed to get profile summary', 'warn', { error: error.message });
      return { combinedSummary: "Profile loading failed" };
    }
  }

  adjustRelevanceWithProfile(originalScore, profileSummary) {
    const confidenceBoost = profileSummary.confidence * 0.2;
    return Math.min(1.0, originalScore + confidenceBoost);
  }

  fallbackPageAnalysis(contentData) {
    const keywords = contentData?.keywords || [];
    
    return {
      relevanceScore: 0.4,
      keyTopics: keywords.slice(0, 3).map(kw => {
        if (!kw) return this.MASTER_TOPIC_BUCKET.UNKNOWN;
        if (kw.includes('tech') || kw.includes('computer')) return this.MASTER_TOPIC_BUCKET.TECHNOLOGY;
        if (kw.includes('health') || kw.includes('medical')) return this.MASTER_TOPIC_BUCKET.HEALTH;
        if (kw.includes('business') || kw.includes('finance')) return this.MASTER_TOPIC_BUCKET.BUSINESS;
        return this.MASTER_TOPIC_BUCKET.UNKNOWN;
      }).filter(topic => topic !== this.MASTER_TOPIC_BUCKET.UNKNOWN).slice(0, 3) || [this.MASTER_TOPIC_BUCKET.UNKNOWN],
      contentType: contentData?.isEducational ? 'informational' : 'other',
      modelUsed: 'fallback'
    };
  }

  fallbackSearchAnalysis(query) {
    const queryLower = query.toLowerCase();
    let intentType = 'informational';
    
    const topicKeywords = {
      [this.MASTER_TOPIC_BUCKET.TECHNOLOGY]: ['tech', 'computer', 'software', 'ai', 'programming', 'code', 'app', 'digital'],
      [this.MASTER_TOPIC_BUCKET.FINANCE]: ['finance', 'money', 'invest', 'stock', 'bank', 'loan', 'credit'],
      [this.MASTER_TOPIC_BUCKET.HEALTH]: ['health', 'medical', 'doctor', 'fitness', 'diet', 'exercise', 'medicine'],
      [this.MASTER_TOPIC_BUCKET.SCIENCE]: ['science', 'research', 'study', 'scientific', 'physics', 'chemistry'],
      [this.MASTER_TOPIC_BUCKET.EDUCATION]: ['education', 'school', 'learn', 'course', 'university', 'student'],
      [this.MASTER_TOPIC_BUCKET.NEWS]: ['news', 'update', 'breaking', 'headline', 'current'],
      [this.MASTER_TOPIC_BUCKET.SPORTS]: ['sports', 'game', 'team', 'player', 'score', 'match'],
      [this.MASTER_TOPIC_BUCKET.ENTERTAINMENT]: ['movie', 'music', 'celebrity', 'film', 'show', 'entertainment'],
      [this.MASTER_TOPIC_BUCKET.BUSINESS]: ['business', 'company', 'corporate', 'enterprise', 'startup'],
      [this.MASTER_TOPIC_BUCKET.TRAVEL]: ['travel', 'trip', 'vacation', 'hotel', 'flight', 'destination']
    };

    const topicScores = {};
    for (const [topic, keywords] of Object.entries(topicKeywords)) {
      let score = 0;
      keywords.forEach(keyword => {
        if (queryLower.includes(keyword)) {
          score += 1;
        }
      });
      if (score > 0) {
        topicScores[topic] = score;
      }
    }
    
    let topicDomains;
    if (Object.keys(topicScores).length > 0) {
      const totalScore = Object.values(topicScores).reduce((sum, score) => sum + score, 0);
      topicDomains = Object.entries(topicScores)
        .slice(0, 2)
        .map(([topic, score]) => ({
          topic,
          weight: parseFloat((score / totalScore).toFixed(3))
        }));
    } else {
      topicDomains = [{ topic: this.MASTER_TOPIC_BUCKET.UNKNOWN, weight: 1.0 }];
    }

    if (queryLower.includes('buy') || queryLower.includes('price')) intentType = 'transactional';
    else if (queryLower.includes('how to')) intentType = 'instructional';
    else if (queryLower.includes('login')) intentType = 'navigational';

    return {
      intentType,
      topicDomains,
      confidence: 0.6,
      specificity: Math.min(query.split(' ').length / 10, 1.0),
      modelUsed: 'fallback'
    };
  }

  validateSearchAnalysisResult(analysis) {
    const requiredFields = ['intentType', 'topicDomains', 'confidence', 'specificity'];
    
    for (const field of requiredFields) {
      if (!(field in analysis)) {
        return false;
      }
    }
    
    const validIntentTypes = ['informational', 'transactional', 'instructional', 'navigational'];
    if (!validIntentTypes.includes(analysis.intentType)) {
      return false;
    }
    
    if (!Array.isArray(analysis.topicDomains) || analysis.topicDomains.length === 0) {
      return false;
    }
    
    let totalWeight = 0;
    for (const topicDomain of analysis.topicDomains) {
      if (!topicDomain.topic || !this.TOPIC_DOMAIN_ENUM.includes(topicDomain.topic)) {
        return false;
      }
      if (typeof topicDomain.weight !== 'number' || topicDomain.weight < 0 || topicDomain.weight > 1) {
        return false;
      }
      totalWeight += topicDomain.weight;
    }
    
    if (Math.abs(totalWeight - 1.0) > 0.01) {
      return false;
    }
    
    if (typeof analysis.confidence !== 'number' || analysis.confidence < 0 || analysis.confidence > 1) {
      return false;
    }
    
    if (typeof analysis.specificity !== 'number' || analysis.specificity < 0 || analysis.specificity > 1) {
      return false;
    }
    
    return true;
  }

  async aiHighlightExtraction(source, pageAnalysis) {
    const profileSummary = await this.getProfileSummary();
    const prompt = ` Profile Context: ${profileSummary.combinedSummary?.substring(0, 300) || "General user"} ${pageAnalysis.summaryCache?.summarizer ? `Content Summary: ${pageAnalysis.summaryCache.summarizer.substring(0, 500)}` : ''} ${pageAnalysis ? `Content Topics: ${pageAnalysis.keyTopics?.join(', ')}` : ''} Source Content: ${source.substring(0, 4000)} Task: Extract 3-5 most important sentences or phrases for highlighting. Focus on sentences that: 1. Contain key insights or main points 2. Are relevant to the user profile 3. Are self-contained and understandable out of context 4. Are between 20-150 characters long Return as a JSON array of strings. Only include the array, no other text. `;
    try {
      const response = await this.languageModel.prompt(prompt, {
        responseConstraint: { 
          type: "array", 
          items: { type: "string", minLength: 20, maxLength: 150 }, 
          minItems: 3, 
          maxItems: 5 
        },
        omitResponseConstraintInput: true
      });
      
      let highlights;
      if (typeof response === 'string') {
        let cleanedResponse = response.trim().replace(/^\s*```(json)?\s*|\s*```\s*$/g, '').trim();
        highlights = JSON.parse(cleanedResponse);
      } else {
        highlights = response;
      }
      
      return Array.isArray(highlights) ? highlights.filter(h => typeof h === 'string' && h.length >= 20 && h.length <= 150) : [];
      
    } catch (error) {
      this.log('AI highlight extraction failed, using fallback', 'warn', { error: error.message });
      return [];
    }
  }

  localHighlightExtraction(source, pageAnalysis) {
    if (!source || typeof source !== 'string') return [];
    
    const sentences = source.split(/[.!?]+/).map(s => s.trim()).filter(s => 
      s.length >= 20 && s.length <= 150
    );
    
    const keyTopics = pageAnalysis?.keyTopics || [];
    const rankedSentences = sentences.map(sentence => {
      let score = 0;
      
      keyTopics.forEach(topic => {
        if (sentence.toLowerCase().includes(topic.toLowerCase())) {
          score += 2;
        }
      });
      
      const index = sentences.indexOf(sentence);
      score += Math.max(0, 1 - (index / sentences.length));
      
      const lengthScore = 1 - Math.abs(80 - sentence.length) / 80;
      score += lengthScore;
      
      return { sentence, score };
    });
    
    return rankedSentences
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map(item => item.sentence);
  }

  deduplicateHighlights(highlights) {
    const unique = [];
    const seen = new Set();
    
    highlights.forEach(highlight => {
      const normalized = highlight.toLowerCase().replace(/\s+/g, ' ').trim();
      const substring = normalized.substring(0, 40);
      
      if (!seen.has(substring)) {
        seen.add(substring);
        unique.push(highlight);
      }
    });
    
    return unique;
  }

  generateDomHint(text) {
    const words = text.split(/\s+/).filter(word => 
      word.length > 4 && !['this', 'that', 'with', 'from', 'have', 'were'].includes(word.toLowerCase())
    );
    
    return words.slice(0, 3).join(' ') || null;
  }

  async loadUserProfileSummary() {
    this.log('Loading user profile summary...', 'info');
    
    try {
      this.profileSummary = "The user has no established profile yet. Act as a neutral, helpful assistant.";
      this.log('Using default profile summary', 'info');
    } catch (error) {
      this.log('Failed to load user profile summary', 'warn', { error: error.message });
      this.profileSummary = "Error loading profile. Act as a neutral, helpful assistant.";
    }
  }

  _getSystemPromptContext() {
    return `You are an expert personalized assistant. Your responses must be tailored based on the user's profile below. Be concise and focus on relevance. 
    USER PROFILE:
    ${this.profileSummary}`;
  }

  _chunkText(text, size) {
    const chunks = [];
    for (let i = 0; i < text.length; i += size) {
      chunks.push(text.substring(i, i + size));
    }
    return chunks;
  }

  sendToContentScript(tabId, message) {
      if (chrome.tabs) {
          chrome.tabs.sendMessage(tabId, message).catch(e => this.log('Failed to send message to content script', 'warn', { error: e.message, tabId }));
      }
  }

  getStatus() {
    const now = new Date();
    const lastHeartbeat = new Date(this.lastHeartbeat);
    const timeSinceLastHeartbeat = now - lastHeartbeat;
    
    return {
      modelAvailable: !!this.languageModel,
      isProcessing: this.isProcessing,
      queueSize: this.taskQueue.length,
      priorityWorkingOn: this.currentPriority,
      lastHeartbeat: this.lastHeartbeat,
      estimatedFreeInMs: this.isProcessing ? 30000 : 0,
      acceptsBackgroundTasks: !this.hasHighPriorityPending() && this.taskQueue.length < 10,
      modelDetails: MODEL_NAME
    };
  }

  hasHighPriorityPending() {
    return this.taskQueue.some(task => task.priority <= PRIORITY.HIGH);
  }
}

/**
 * BackgroundService - Updated with Profile-First Pipeline
 */
class BackgroundService {
  constructor() {
    this.sessionId = null;
    this.sessionStartTime = null; // <-- ADD THIS
    this.activeTabs = new Map();
    this.dbService = null;
    this.newTabIds = new Set();
    this.aiSchedulerInterval = null;
    this.schedulerIntervalMs = 30000;

    this.init().catch(err => {
      console.error('[Background] init failed:', err);
    });
  }

  async init() {
    await this.initializeDatabase();
    await this.initializeDefaultSettings(); // <-- ADD THIS
    this.aiOrchestrator = new AIOrchestrator(this.dbService);
    this.aiOrchestrator.backgroundService = this;
    await this.initializeSession();
    this.setupTabMonitoring();
    this.setupMessageHandlers();
    this.startAIScheduler();
    console.log('🔄 Background service initialized with Profile-First AI Orchestrator');
  }

  async initializeDatabase() {
    try {
      this.dbService = new DatabaseService();
      await this.dbService.initialize();
      console.log('✅ Database service ready');
    } catch (error) {
      console.error('❌ Database initialization failed:', error);
      throw error;
    }
  }

  // <-- ADD THIS ENTIRE METHOD -->
  async initializeDefaultSettings() {
    try {
      if (!this.dbService) {
          this.log('Database service not ready for settings', 'error');
          return;
      }
      
      const defaults = {
        'settings:profileSyncEnabled': true,
        'settings:aiEnabled': true,
        'settings:orbTheme': false // false = default theme, true = alt theme
      };
      
      for (const [key, value] of Object.entries(defaults)) {
        const state = await this.dbService.getSystemState(key);
        if (state === null) { // Only set if it doesn't exist
          await this.dbService.setSystemState(key, value);
          this.log(`Initialized default setting: ${key}`, 'info');
        }
      }
    } catch (error) {
      this.log('Failed to initialize default settings', 'error', error);
    }
  }

  log(message, level = 'info', data = null) {
    const timestamp = new Date().toISOString();
    const styles = {
      debug: 'color: gray',
      info: 'color: blue',
      warn: 'color: orange',
      error: 'color: red'
    };

    console.log(`%c[Background-${level.toUpperCase()}] ${timestamp}: ${message}`, styles[level] || 'color: black');
    if (data) {
      console.log(`%c[Background-DATA]`, 'color: purple', data);
    }
  }

  async initializeSession() {
    if (!this.dbService) {
      throw new Error('Database service not initialized');
    }

    this.sessionStartTime = new Date().toISOString(); // <-- ADD THIS
    this.sessionId = `session-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    await this.dbService.saveSession({
      sessionId: this.sessionId,
      startTime: this.sessionStartTime, // <-- USE IT HERE
      endTime: null,
      isActive: true,
      tabIds: []
    });

    console.log('🆕 Browser session started:', this.sessionId);
  }

  setupMessageHandlers() {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      this.handleMessage(request, sender, sendResponse);
      return true;
    });
  }

  // <-- ADD THIS ENTIRE METHOD -->
  async notifyAllTabs(messageType) {
    try {
      const tabs = await chrome.tabs.query({});
      for (const tab of tabs) {
        // Check tab.id and avoid sending messages to restricted pages
        if (tab.id && tab.url && !tab.url.startsWith('chrome://') && !tab.url.startsWith('devtools://') && !tab.url.includes('chrome.google.com')) {
          chrome.tabs.sendMessage(tab.id, { type: messageType }).catch(e => {
            // This error is expected if a content script isn't injected
          });
        }
      }
    } catch (error) {
      this.log('Failed to notify all tabs', 'error', error);
    }
  }

  async handleMessage(request, sender, sendResponse) {
    const response = { success: false, error: 'Unknown request' };

    try {
      if (!this.dbService) {
        response.error = 'Database service not ready';
        sendResponse(response);
        return;
      }

      switch (request.type) {
        
        // ===================================
        // <-- ADD/REPLACE THESE CASES -->
        // ===================================
        case 'GET_SESSION_START_TIME':
          response.data = { startTime: this.sessionStartTime || new Date().toISOString() };
          response.success = true;
          break;

        case 'GET_ALL_SETTINGS':
          response.data = {
            profileSyncEnabled: await this.dbService.getSystemState('settings:profileSyncEnabled'),
            aiEnabled: await this.dbService.getSystemState('settings:aiEnabled'),
            orbTheme: await this.dbService.getSystemState('settings:orbTheme')
          };
          response.success = true;
          break;
          
        case 'TOGGLE_TRACKING': // Sent by popup.js
          await this.dbService.setSystemState('settings:profileSyncEnabled', request.enabled);
          await this.notifyAllTabs('SETTINGS_UPDATED'); // Notify content scripts
          response.success = true;
          break;

        case 'TOGGLE_AI': // Sent by popup.js
          await this.dbService.setSystemState('settings:aiEnabled', request.enabled);
          await this.notifyAllTabs('SETTINGS_UPDATED'); // Notify content scripts
          response.success = true;
          break;

        case 'TOGGLE_ORB': // Sent by popup.js
          const currentTheme = await this.dbService.getSystemState('settings:orbTheme');
          const newTheme = !currentTheme;
          await this.dbService.setSystemState('settings:orbTheme', newTheme);
          await this.notifyAllTabs('SETTINGS_UPDATED'); // Notify content scripts
          response.data = { orbTheme: newTheme }; // Send back the new state
          response.success = true;
          break;

        // ===================================
        // <-- END OF ADDED/REPLACED CASES -->
        // ===================================


        case 'GET_SESSION_ID':
          response.data = {
            sessionId: this.sessionId,
            tabId: sender.tab?.id
          };
          response.success = true;
          break;

        case 'GET_TAB_ID':
          response.data = await this.getTabInfo(sender.tab?.id);
          response.success = true;
          break;

        case 'GET_CURRENT_TAB':
          response.data = await this.getCurrentTabInfo();
          response.success = true;
          break;

        case 'GET_TAB_COUNT':
          response.data = await this.getTabCount();
          response.success = true;
          break;

        case 'AI_TASK_REQUEST':
          const taskRequest = {
            type: request.data.taskType,
            id: request.data.id || `task-${Date.now()}`,
            data: request.data.data || request.data,
            priority: request.data.priority || PRIORITY.MEDIUM,
            tabId: sender.tab?.id,
            callback: true
          };
          
          response.data = await this.handleAITaskRequest(taskRequest, sender.tab?.id);
          response.success = true;
          break;

        case 'GET_AI_STATUS':
          response.data = this.aiOrchestrator.getStatus();
          response.success = true;
          break;

        // 🎯 PROFILE-FIRST PIPELINE HANDLERS
        case 'SUMMARIZE_CHUNK_WITH_PROFILE':
          const profileChunkTask = {
            type: 'SUMMARIZE_CHUNK_WITH_PROFILE',
            id: `chunk-${Date.now()}`,
            data: request.data,
            priority: PRIORITY.HIGH,
            tabId: sender.tab?.id,
            callback: true
          };
          response.data = await this.handleAITaskRequest(profileChunkTask, sender.tab?.id);
          response.success = true;
          break;

        case 'GENERATE_FINAL_INSIGHT':
          const insightTask = {
            type: 'GENERATE_FINAL_INSIGHT',
            id: `insight-${Date.now()}`,
            data: request.data,
            priority: PRIORITY.HIGH,
            tabId: sender.tab?.id,
            callback: true
          };
          response.data = await this.handleAITaskRequest(insightTask, sender.tab?.id);
          response.success = true;
          break;

        // ... (all your other existing cases for GET_STATS, SAVE_SNAPSHOT, etc.)
        // ... (these do not need to change)
        
        case 'GET_STATS':
            // Uses the new function that handles 'ltp' or 'stp'
            response.data = await this.dbService.getDashboardStats(request.view || 'ltp');
            response.success=true;
            break;

        case 'GET_DOMAIN_BEHAVIORS':
            // Uses the new function that handles 'ltp' or 'stp'
            response.data = await this.dbService.getDomainBehaviors(request.view, request.limit);
            response.success=true;
            break;
        
        case 'GET_USER_PROFILE_F':
            // Uses the new function that structures profile data
            response.data = await this.dbService.getUserProfile(request.view);
            response.success=true;
            break;
        
        // --- Other requests from your dashboard.js ---
        case 'GET_SNAPSHOTS':
            response.data = await this.dbService.getRecentSnapshots(request.limit);
            response.success=true;
            break;
        
        case 'GET_RECENT_SEARCHES':
            response.data = await this.dbService.getRecentSearches(request.limit);
            response.success=true;
            break;

        case 'GET_FACTS':
            // Placeholder: You'll need to implement getFacts in dbService
            response.data = []; // await dbService.getFacts(request.view);
            response.success=true;
            break;
        
        case 'GENERATE_NEW_FACTS':
            // Placeholder
            response.data = { success: true };
            response.success=true;
            break;

        case 'SAVE_SNAPSHOT':
            response.data = await this.saveSnapshot(request.data, sender.tab?.id);
            response.success = true;
            break;

        // This case is from your loadDomainEngagement, which is now changed
        // You can leave it or remove it.
        case 'GET_DOMAIN_METRICS':
            response.data = { avgEng: 0, totalTime: 0, focus: 'N/A' };
            response.success=true;
            break;

        case 'SAVE_SEARCH_BASIC':
          response.data = await this.saveSearchBasic(request.data, sender.tab?.id);
          response.success = true;
          break;

        case 'GET_USER_PROFILE':
          response.data = await this.getUserProfileForContent();
          response.success = true;
          break;

        case 'TRACK_RESULT_CLICK':
          response.data = await this.saveResultClick(request.data, sender.tab?.id);
          response.success = true;
          break;

        case 'SAVE_BEHAVIOR_DATA':
          try {
            const result = await this.saveBehaviorData(request.data);
            response.data = result;
            response.success = result.success;
            if (!result.success) {
              response.error = result.error;
            }
          } catch (error) {
            console.warn('Non-critical behavior save error:', error.message);
            response.success = false;
            response.error = error.message;
          }
          break;

        case 'UPDATE_SEARCH_ENRICHMENT':
          try {
            const result = await this.updateSearchEnrichment(request.data);
            response.data = result;
            response.success = result.success;
            if (!result.success) {
              response.error = result.error;
            }
          } catch (error) {
            console.warn('Non-critical search enrichment error:', error.message);
            response.success = false;
            response.error = error.message;
          }
          break;
        case 'GENERATE_SUMMARY_OF_SUMMARIES': // ADD THIS CASE
        const summaryTask = {
          type: 'GENERATE_SUMMARY_OF_SUMMARIES',
          id: `summary-summaries-${Date.now()}`,
          data: request.data,
          priority: PRIORITY.HIGH,
          tabId: sender.tab?.id,
          callback: true
        };
        response.data = await this.handleAITaskRequest(summaryTask, sender.tab?.id);
        response.success = true;
        break;

        case 'REQUEST_AI_PROCESSING':
          response.data = await this.scheduleAIProcessing(request.data);
          response.success = true;
          break;

        case 'GET_USER_PROFILEQ':
          response.data = await this.dbService.getProfileSummary();
          response.success = true;
          break;

        case 'UPDATE_USER_PROFILE':
          response.data = await this.updateUserProfile(request.data);
          response.success = true;
          break;

        case 'GENERATE_PROFILE_SUMMARY':
          response.data = await this.handleProfileSummaryGeneration(request.data);
          response.success = true;
          break;

        case 'GET_PROFILE_SUMMARY':
          response.data = await this.getProfileSummary();
          response.success = true;
          break;

        case 'OPEN_SNAPSHOT':
          response.data = await this.openSnapshot(request.snapshotId);
          response.success = true;
          break;
          
        default:
          response.error = `Unknown request type: ${request.type}`;
      }

    } catch (error) {
      console.error('Error handling message:', error, request);
      response.success=false;
      response.error = error?.message || String(error);
    }

    try { sendResponse(response); } catch (e) { /* ignore */ }
  }

  // ... (rest of your BackgroundService class)
  // ... (handleAITaskRequest, saveSnapshot, setupTabMonitoring, etc.)
  // ... (all other methods remain unchanged)
  // ...
  
  async handleAITaskRequest(taskData, tabId) {
    try {
      console.log('🔄 Background: Handling AI task request', {
        type: taskData.type,
        id: taskData.id,
        hasData: !!taskData.data
      });

      const aiTask = {
        type: taskData.type,
        id: taskData.id,
        data: taskData.data,
        priority: taskData.priority || PRIORITY.MEDIUM,
        tabId: tabId,
        callback: true
      };

      const result = await this.aiOrchestrator.scheduleAITask(aiTask);
      
      console.log('✅ Background: AI task scheduled', {
        type: aiTask.type,
        success: result?.success
      });

      return result;
    } catch (error) {
      console.error('❌ Background: AI task request failed:', error.message);
      return { success: false, error: error.message };
    }
  }

  async handleProfileSummaryGeneration(taskData) {
    try {
      console.log('🔄 Background: Handling profile summary generation');
      
      const result = await this.handleAITaskRequest({
        type: 'PROFILE_SUMMARY_GENERATION',
        id: `summary-${Date.now()}`,
        data: taskData,
        priority: 1,
        updateDatabase: true
      }, null);

      console.log('✅ Background: Profile summary generation completed', {
        success: result?.success
      });

      return result;
    } catch (error) {
      console.error('❌ Background: Profile summary generation failed:', error);
      return { success: false, error: error.message };
    }
  }
async saveSnapshot(snapshotData, tabId = null) {
  try {
    if (!this.dbService) {
      throw new Error('Database service not available');
    }

    const snapshotRecord = {
      snapshotId: `snapshot-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      sessionId: this.sessionId,
      timestamp: new Date().toISOString(),
      url: snapshotData.url || window.location.href,
      summary: snapshotData.summary || '',
      insights: Array.isArray(snapshotData.insights) ? snapshotData.insights : [],
      tabId: tabId,
      priority: 'high'
    };

    const result = await this.dbService.saveSnapshot(snapshotRecord);
    
    console.log('✅ Snapshot saved:', {
      snapshotId: snapshotRecord.snapshotId,
      url: snapshotRecord.url,
      summaryLength: snapshotRecord.summary?.length,
      insightsCount: snapshotRecord.insights.length
    });

    return { success: true, snapshotId: snapshotRecord.snapshotId };
  } catch (error) {
    console.error('❌ Failed to save snapshot:', error);
    return { success: false, error: error.message };
  }
}
  async getUserProfileForContent() {
    try {
      const profile = await this.dbService.getProfile();
      const ltp = profile.ltp || {};
      const profileSummary = profile.profileSummary || {};
      
      const topics = [];
      if (ltp.topic_cumulative) {
        const topicEntries = Object.entries(ltp.topic_cumulative)
          .sort((a, b) => {
            const aScore = typeof a[1] === 'object' ? a[1].rawScore : a[1];
            const bScore = typeof b[1] === 'object' ? b[1].rawScore : b[1];
            return bScore - aScore;
          })
          .slice(0, 5);
        
        topicEntries.forEach(([topic, data]) => {
          topics.push(topic);
        });
      }
      
      return {
        summary: profileSummary.combinedSummary || 'General user',
        topics: topics,
        confidence: ltp.confidence || 0,
        focusStyle: ltp.ewma_focus > 0.7 ? 'focused' : 
                     ltp.ewma_focus < 0.3 ? 'exploratory' : 'balanced'
      };
    } catch (error) {
      console.error('Failed to get user profile:', error);
      return {
        summary: 'General user',
        topics: [],
        confidence: 0,
        focusStyle: 'balanced'
      };
    }}

  async getProfileSummary() {
    try {
      if (!this.dbService) {
        throw new Error('Database service not available');
      }
      return await this.dbService.getProfileSummary();
    } catch (error) {
      console.error('Failed to get profile summary:', error);
      return this.dbService.getDefaultProfileSummary();
    }
  }

  setupTabMonitoring() {
    console.log('📑 Setting up tab monitoring...');

    chrome.tabs.query({}, (tabs) => {
      (tabs || []).forEach(tab => {
        this.activeTabs.set(tab.id, {
          tabId: tab.id,
          url: tab.url,
          title: tab.title,
          createdAt: Date.now(),
          lastActive: Date.now(),
          status: 'existing'
        });
      });
      console.log(`📑 Loaded ${tabs?.length || 0} existing tabs`);
    });

    chrome.tabs.onCreated.addListener((tab) => {
      this.activeTabs.set(tab.id, {
        tabId: tab.id,
        url: tab.url,
        title: tab.title,
        createdAt: Date.now(),
        lastActive: Date.now(),
        status: 'new'
      });
    });

    chrome.tabs.onRemoved.addListener((tabId) => {
      this.activeTabs.delete(tabId);
      this.newTabIds.delete(tabId);
    });

    chrome.tabs.onActivated.addListener((activeInfo) => {
      const tab = this.activeTabs.get(activeInfo.tabId);
      if (tab) {
        tab.lastActive = Date.now();
        tab.status = 'active';
        this.activeTabs.set(activeInfo.tabId, tab);
      }
    });

    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
      if (changeInfo.url || changeInfo.title) {
        const existingTab = this.activeTabs.get(tabId) || {};
        if (changeInfo.url) existingTab.url = changeInfo.url;
        if (changeInfo.title) existingTab.title = changeInfo.title;
        existingTab.lastActive = Date.now();
        existingTab.updated = true;
        this.activeTabs.set(tabId, existingTab);
      }
    });
  }

  startAIScheduler() {
    console.log('🔄 Starting AI Task Scheduler...');
    
    if (this.aiSchedulerInterval) {
      clearInterval(this.aiSchedulerInterval);
    }
    
    this.aiSchedulerInterval = setInterval(() => {
      this.checkAndProcessAITasks();
    }, this.schedulerIntervalMs);
  }

  async checkAndProcessAITasks() {
    try {
      const tabCount = await this.getTabCount();
      if (tabCount > 15) {
        console.log(`Skipping AI processing - too many tabs: ${tabCount}`);
        return;
      }

      const aiStatus = this.aiOrchestrator.getStatus();
      if (!aiStatus.modelAvailable || aiStatus.isProcessing || !aiStatus.acceptsBackgroundTasks) {
        console.log('AI not available or busy - skipping');
        return;
      }

      const health = await this.aiOrchestrator.checkSessionHealth();
      if (!health.healthy) {
        console.log('AI session unhealthy - skipping', health.reason);
        return;
      }

      let pendingCount;
      try {
        pendingCount = await this.dbService.getPendingAITasksCount();
      } catch (error) {
        console.error('Error getting pending task count:', error.message);
        return;
      }
      
      if (pendingCount === 0) {
        return;
      }

      if (pendingCount < 3) {
        console.log(`Not enough tasks: ${pendingCount}/5`);
        return;
      }

      console.log(`🚀 Processing AI tasks - ${pendingCount} pending`);
      await this.processPendingAITasks();

    } catch (error) {
      console.error('AI scheduler error:', error.message);
    }
  }

  async processPendingAITasks() {
    try {
      const pendingTasks = await this.dbService.getPendingAITasks(5);
      
      if (pendingTasks.length === 0) return;

      console.log(`Processing ${pendingTasks.length} AI tasks`);

      for (const task of pendingTasks) {
        await this.processSingleAITask(task);
      }

    } catch (error) {
      console.error('Error processing AI tasks:', error);
    }
  }

  async processSingleAITask(task) {
    try {
      console.log(`🔄 Processing AI task: ${task.type}`, task);

      const taskData = {
        type: task.type,
        id: task.id,
        data: {
          ...task.data,
          queueTaskId: task.id 
        },
        priority: task.priority || PRIORITY.BACKGROUND,
        updateDatabase: true 
      };

      const result = await this.handleAITaskRequest(taskData, null);

      if (result && result.success) {
        console.log(`✅ AI task ${task.id} completed successfully`);
        return;
      }

      console.warn(`⚠️ AI task ${task.id} failed:`, result?.error);
      
      if (task.type === 'TOPIC_INFERENCE') {
        try {
          await this.dbService.updateTopicDomains(
            task.data.recordId,
            [{ topic: 'Unknown', weight: 1.0 }],
            task.id
          );
        } catch (dbError) {
          console.error('Failed to update topic domain fallback:', dbError);
        }
      }

    } catch (error) {
      console.error(`❌ AI task ${task.id} failed with exception:`, error);
      
      if (task.type === 'TOPIC_INFERENCE') {
        try {
          await this.dbService.updateTopicDomains(
            task.data.recordId,
            [{ topic: 'Unknown', weight: 1.0 }],
            task.id
          );
        } catch (dbError) {
          console.error('Failed to update topic domain fallback:', dbError);
        }
      }
    }
  }

  async getTabInfo(requestedTabId = null) {
    const tabId = requestedTabId;

    if (tabId && this.activeTabs.has(tabId)) {
      return this.activeTabs.get(tabId);
    }

    if (tabId) {
      try {
        const tab = await new Promise((resolve) => chrome.tabs.get(tabId, resolve));
        if (tab) {
          const entry = {
            tabId: tab.id,
            url: tab.url,
            title: tab.title,
            lastActive: Date.now(),
            status: 'queried'
          };
          this.activeTabs.set(tabId, entry);
          return entry;
        }
      } catch (err) {
        console.log('Tab not found via chrome.tabs.get:', tabId, err);
      }
    }

    return this.getCurrentTabInfo();
  }

  async getTabCount() {
    try {
      const tabs = await new Promise((resolve) => chrome.tabs.query({ windowType: 'normal' }, resolve));
      return tabs.length;
    } catch (error) {
      console.log('error in fetching tab counts', error);
      return 0;
    }
  }

  async getCurrentTabInfo() {
    try {
      const tabs = await new Promise((resolve) => chrome.tabs.query({ active: true, currentWindow: true }, resolve));
      const tab = tabs?.[0];
      if (tab) {
        const entry = {
          tabId: tab.id,
          url: tab.url,
          title: tab.title,
          lastActive: Date.now(),
          status: 'current'
        };
        this.activeTabs.set(tab.id, entry);
        return entry;
      }
    } catch (error) {
      console.error('Error getting current tab:', error);
    }

    return {
      tabId: 'unknown',
      url: 'unknown',
      title: 'Unknown Tab',
      lastActive: Date.now(),
      status: 'fallback'
    };
  }

  async saveSearchBasic(searchData, senderTabId = null) {
    if (!this.dbService) throw new Error('Database service not available');

    const searchRecord = {
      searchId: searchData.searchId || `search-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
      query: searchData.query,
      source: searchData.source,
      timestamp: new Date().toISOString(),
      sessionId: this.sessionId,
      tabId: searchData.tabId || senderTabId || null,
      url: searchData.url || null,
      intentType: null,
      topicDomain: null,
      confidence: null,
      specificity: null,
      searchComplexity: null,
      aiModelUsed: null,
      resultsClicked: [],
      processed: false
    };

    await this.dbService.saveSearch(searchRecord);

    const tabId = searchRecord.tabId;
    if (tabId != null) {
      const meta = this.activeTabs.get(tabId) || {};
      meta.tabId = tabId;
      meta.url = meta.url || searchRecord.url;
      meta.lastQuery = searchRecord.query;
      meta.lastSearchId = searchRecord.searchId;
      meta.sessionId = this.sessionId;
      meta.lastSearchTimestamp = searchRecord.timestamp;
      this.activeTabs.set(tabId, meta);
    }

    return { searchId: searchRecord.searchId };
  }

  async updateSearchEnrichment(enrichmentData) {
    try {
      if (!this.dbService || typeof this.dbService.enrichSearchesByQuery !== 'function') {
        throw new Error('Database service or enrichment method not available');
      }

      const result = await this.dbService.enrichSearchesByQuery(
        enrichmentData.query,
        enrichmentData.enrichment,
        enrichmentData.enrichedAt
      );

      if (result.success) {
        console.log('✅ Search enrichment completed for query:', enrichmentData.query);
      } else {
        console.warn('⚠️ Search enrichment failed for query:', enrichmentData.query);
      }

      return result;
    } catch (error) {
      console.error('❌ Search enrichment update failed:', error.message);
      return { success: false, error: error.message };
    }
  }

  async saveResultClick(clickData, senderTabId = null) {
    if (!this.dbService) throw new Error('Database service not available');

    const essentialData = {
      query: clickData.query,
      resultUrl: clickData.resultUrl,
      tabId: clickData.tabId || senderTabId || 'unknown-tab',
      sessionId: clickData.sessionId || this.sessionId
    };

    if (!essentialData.query) {
      throw new Error('Query is required');
    }
    if (!essentialData.resultUrl) {
      throw new Error('Result URL is required');
    }

    console.log('🎯 Processing click - essential data only:', essentialData);

    return await this.dbService.saveResultClick(essentialData);
  }

  async saveBehaviorData(behaviorData) {
    if (!this.dbService) throw new Error('Database service not available');

    try {
      if (!behaviorData) {
        throw new Error('Behavior data is null or undefined');
      }

      if (!behaviorData.domain || behaviorData.domain === 'pending') {
        console.warn('🚫 Rejecting behavior data with invalid domain:', behaviorData.domain);
        throw new Error(`Invalid domain: ${behaviorData.domain}`);
      }

      if (!behaviorData.sessionId || behaviorData.sessionId === 'pending') {
        console.warn('🚫 Rejecting behavior data with invalid sessionId:', behaviorData.sessionId);
        throw new Error(`Invalid sessionId: ${behaviorData.sessionId}`);
      }

      if (!behaviorData.url || behaviorData.url === 'pending') {
        console.warn('🚫 Rejecting behavior data with invalid url:', behaviorData.url);
        throw new Error(`Invalid url: ${behaviorData.url}`);
      }

      if (!behaviorData.engagement) {
        console.warn('🚫 Rejecting behavior data with missing engagement data');
        throw new Error('Missing engagement data');
      }

      const existingRecord = await this.getExistingBehaviorRecord(
        behaviorData.sessionId, 
        behaviorData.tabId, 
        behaviorData.url
      );

      const contentSample = this.handleContentSample(
        behaviorData.contentSample, 
        existingRecord?.contentSample
      );

      const enhancedBehaviorData = {
        ...behaviorData,
        url: behaviorData.url || 'unknown',
        sessionId: behaviorData.sessionId,
        tabId: behaviorData.tabId || 'unknown',
        engagement: this.normalizeEngagementData(behaviorData.engagement || {}),
        contentSample: contentSample,
        topicDomain: behaviorData.topicDomain || existingRecord?.topicDomain || null,
        wordCount: Math.max(0, Number(behaviorData.wordCount || 0)),
        topicInferenceSent: existingRecord?.topicInferenceSent || false,
        topicInferenceProcessing: existingRecord?.topicInferenceProcessing || false,
        startTime: behaviorData.startTime,
        endTime: behaviorData.endTime || new Date().toISOString()
      };

      console.log('✅ Processing valid behavior data:', {
        domain: enhancedBehaviorData.domain,
        sessionId: enhancedBehaviorData.sessionId,
        tabId: enhancedBehaviorData.tabId,
        activeTime: enhancedBehaviorData.engagement.activeTime,
        scrollDepth: enhancedBehaviorData.engagement.scrollDepth,
        engagementScore: enhancedBehaviorData.engagement.engagementScore,
        hasContentSample: !!enhancedBehaviorData.contentSample,
        contentSampleLength: enhancedBehaviorData.contentSample?.length || 0
      });

      const result = await this.dbService.saveBehaviorData(enhancedBehaviorData);

      return { success: true, result };

    } catch (error) {
      console.error('❌ Behavior data save failed:', error.message);
      return { success: false, error: error.message };
    }
  }

  async getExistingBehaviorRecord(sessionId, tabId, url) {
    try {
        if (!this.dbService?.db) return null;
        
        const record = await this.dbService.db.urlBehaviors
            .where('[sessionId+tabId+url]')
            .equals([sessionId, tabId, url])
            .first();
            
        return record || null;
    } catch (error) {
        console.warn('Error fetching existing behavior record:', error);
        return null;
    }
  }

  handleContentSample(newContentSample, existingContentSample) {
    if (newContentSample && typeof newContentSample === 'string' && newContentSample.length > 0) {
        console.log('📄 Using new content sample, length:', newContentSample.length);
        return newContentSample;
    }
    
    if (existingContentSample && typeof existingContentSample === 'string' && existingContentSample.length > 0) {
        console.log('📄 Preserving existing content sample, length:', existingContentSample.length);
        return existingContentSample;
    }
    
    console.log('📄 No content sample available');
    return null;
  }

  normalizeEngagementData(engagement) {
    const normalized = {
      activeTime: Math.max(0, Number(engagement.activeTime || 0)),
      scrollDepth: Math.min(100, Math.max(0, Number(engagement.scrollDepth || 0))),
      clicks: Math.max(0, Number(engagement.clicks || 0)),
      copies: Math.max(0, Number(engagement.copies || 0)),
      pastes: Math.max(0, Number(engagement.pastes || 0)),
      highlights: Math.max(0, Number(engagement.highlights || 0)),
      tabSwitches: Math.max(0, Number(engagement.tabSwitches || 0))
    };

    normalized.engagementScore = this.calculateEngagementScore(normalized);

    return normalized;
  }

  calculateEngagementScore(engagement) {
    const scores = {
      timeScore: this.calculateTimeScore(engagement.activeTime),
      contentScore: this.calculateContentScore(engagement.scrollDepth, engagement.highlights),
      interactionScore: this.calculateInteractionScore(engagement.clicks, engagement.copies, engagement.pastes),
      focusScore: this.calculateFocusScore(engagement.tabSwitches)
    };

    const totalScore = scores.timeScore + scores.contentScore + scores.interactionScore + scores.focusScore;
    return Math.min(100, Math.max(0, Math.round(totalScore)));
  }

  calculateTimeScore(activeTime) {
    if (activeTime <= 30) return Math.round((activeTime / 30) * 10);
    if (activeTime <= 300) return 10 + Math.round(((activeTime - 30) / 270) * 20);
    return 30 + Math.round(Math.min(10, (activeTime - 300) / 60));
  }

  calculateContentScore(scrollDepth, highlights) {
    const scrollPoints = (scrollDepth / 100) * 20;
    const highlightPoints = Math.min(10, highlights * 2);
    return Math.round(scrollPoints + highlightPoints);
  }

  calculateInteractionScore(clicks, copies, pastes) {
    const totalInteractions = clicks + copies + pastes;
    if (totalInteractions === 0) return 0;
    if (totalInteractions <= 5) return totalInteractions * 2;
    if (totalInteractions <= 10) return 10 + (totalInteractions - 5);
    return 15 + Math.min(5, Math.floor((totalInteractions - 10) / 2));
  }

  calculateFocusScore(tabSwitches) {
    if (tabSwitches === 0) return 10;
    if (tabSwitches <= 2) return 7;
    return 3;
  }

  async scheduleAIProcessing(processingData) {
    try {
      const result = await this.handleAITaskRequest({
        type: processingData.taskType,
        id: processingData.taskId,
        data: processingData.data,
        priority: processingData.priority || PRIORITY.MEDIUM
      }, processingData.tabId);
      
      return result;
    } catch (error) {
      console.error('AI processing scheduling failed:', error);
      return { success: false, error: error.message };
    }
  }

  async updateUserProfile(profileData) {
    try {
      const result = await this.dbService.updateProfile(profileData);
      return result;
    } catch (error) {
      console.error('Profile update failed:', error);
      return { success: false, error: error.message };
    }
  }

  

  async getDomainBehaviors(timeRange = '7d', limit = 20) {
    try {
      const behaviors = await this.dbService.getDomainBehaviors(timeRange, limit);
      return behaviors;
    } catch (error) {
      console.error('Failed to get domain behaviors:', error);
      return { error: error.message };
    }
  }

  async getSnapshots(limit = 50, timeRange = '30d') {
    try {
      const snapshots = await this.dbService.getDashboardStats();
      return snapshots.snapshotCount;
    } catch (error) {
      console.error('Failed to get snapshots:', error);
      return { error: error.message };
    }
  }

  async getRecentSearches(limit = 20, timeRange = '7d') {
    try {
      const searches = await this.dbService.getRecentSearches(limit, timeRange);
      return searches;
    } catch (error) {
      console.error('Failed to get recent searches:', error);
      return { error: error.message };
    }
  }

  async openSnapshot(snapshotId) {
    try {
      const snapshot = await this.dbService.getSnapshot(snapshotId);
      if (snapshot && snapshot.url) {
        chrome.tabs.create({ url: snapshot.url });
        return { success: true };
      }
      return { success: false, error: 'Snapshot not found' };
    } catch (error) {
      console.error('Failed to open snapshot:', error);
      return { success: false, error: error.message };
    }
  }
}

// Initialize the background service instance
const backgroundService = new BackgroundService();