"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.TrinityStack = void 0;
const cdk = __importStar(require("aws-cdk-lib"));
const dynamodb = __importStar(require("aws-cdk-lib/aws-dynamodb"));
const cognito = __importStar(require("aws-cdk-lib/aws-cognito"));
const appsync = __importStar(require("aws-cdk-lib/aws-appsync"));
const lambda = __importStar(require("aws-cdk-lib/aws-lambda"));
const lambdaNodejs = __importStar(require("aws-cdk-lib/aws-lambda-nodejs"));
const path = __importStar(require("path"));
class TrinityStack extends cdk.Stack {
    constructor(scope, id, props) {
        super(scope, id, props);
        // Create DynamoDB Tables
        this.createDynamoDBTables();
        // Create Cognito User Pool
        this.createCognitoUserPool();
        // Create AppSync GraphQL API
        this.createAppSyncAPI();
        // Create Lambda Functions
        this.createLambdaFunctions();
        // Create AppSync Resolvers
        this.createResolvers();
        // Output important values
        this.createOutputs();
    }
    createDynamoDBTables() {
        // TrinityRooms Table
        this.roomsTable = new dynamodb.Table(this, 'TrinityRooms', {
            tableName: 'TrinityRooms',
            partitionKey: {
                name: 'id',
                type: dynamodb.AttributeType.STRING,
            },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            removalPolicy: cdk.RemovalPolicy.DESTROY, // For development
            pointInTimeRecovery: true,
            timeToLiveAttribute: 'ttl',
        });
        // Global Secondary Index for room code lookup
        this.roomsTable.addGlobalSecondaryIndex({
            indexName: 'code-index',
            partitionKey: {
                name: 'code',
                type: dynamodb.AttributeType.STRING,
            },
        });
        // TrinityVotes Table
        this.votesTable = new dynamodb.Table(this, 'TrinityVotes', {
            tableName: 'TrinityVotes',
            partitionKey: {
                name: 'roomId',
                type: dynamodb.AttributeType.STRING,
            },
            sortKey: {
                name: 'userMovieId',
                type: dynamodb.AttributeType.STRING,
            },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            pointInTimeRecovery: true,
        });
        // TrinityMatches Table
        this.matchesTable = new dynamodb.Table(this, 'TrinityMatches', {
            tableName: 'TrinityMatches',
            partitionKey: {
                name: 'roomId',
                type: dynamodb.AttributeType.STRING,
            },
            sortKey: {
                name: 'movieId',
                type: dynamodb.AttributeType.NUMBER,
            },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            pointInTimeRecovery: true,
        });
        // Local Secondary Index for timestamp-based queries
        this.matchesTable.addLocalSecondaryIndex({
            indexName: 'timestamp-index',
            sortKey: {
                name: 'timestamp',
                type: dynamodb.AttributeType.STRING,
            },
        });
        // TrinityUsers Table
        this.usersTable = new dynamodb.Table(this, 'TrinityUsers', {
            tableName: 'TrinityUsers',
            partitionKey: {
                name: 'id',
                type: dynamodb.AttributeType.STRING,
            },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            pointInTimeRecovery: true,
        });
    }
    createCognitoUserPool() {
        // Create User Pool
        this.userPool = new cognito.UserPool(this, 'TrinityUserPool', {
            userPoolName: 'trinity-user-pool',
            selfSignUpEnabled: true,
            signInAliases: {
                email: true,
            },
            autoVerify: {
                email: true,
            },
            standardAttributes: {
                email: {
                    required: true,
                    mutable: true,
                },
            },
            passwordPolicy: {
                minLength: 8,
                requireLowercase: true,
                requireUppercase: true,
                requireDigits: true,
                requireSymbols: false,
            },
            accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
        });
        // Create User Pool Client
        this.userPoolClient = new cognito.UserPoolClient(this, 'TrinityUserPoolClient', {
            userPool: this.userPool,
            userPoolClientName: 'trinity-mobile-client',
            generateSecret: false, // Required for mobile apps
            authFlows: {
                userSrp: true,
                userPassword: true,
            },
            preventUserExistenceErrors: true,
        });
    }
    createAppSyncAPI() {
        // Create AppSync GraphQL API
        this.api = new appsync.GraphqlApi(this, 'TrinityAPI', {
            name: 'trinity-api',
            definition: appsync.Definition.fromFile(path.join(__dirname, '../schema.graphql')),
            authorizationConfig: {
                defaultAuthorization: {
                    authorizationType: appsync.AuthorizationType.USER_POOL,
                    userPoolConfig: {
                        userPool: this.userPool,
                    },
                },
            },
            logConfig: {
                fieldLogLevel: appsync.FieldLogLevel.ALL,
            },
            xrayEnabled: true,
        });
    }
    createLambdaFunctions() {
        // Common Lambda configuration
        const commonLambdaProps = {
            runtime: lambda.Runtime.NODEJS_20_X,
            timeout: cdk.Duration.seconds(30),
            memorySize: 512,
            environment: {
                TMDB_API_KEY: process.env.TMDB_API_KEY || '',
                TMDB_READ_TOKEN: process.env.TMDB_READ_TOKEN || '',
                TMDB_BASE_URL: process.env.TMDB_BASE_URL || 'https://api.themoviedb.org/3',
                ROOMS_TABLE: this.roomsTable.tableName,
                VOTES_TABLE: this.votesTable.tableName,
                MATCHES_TABLE: this.matchesTable.tableName,
                USERS_TABLE: this.usersTable.tableName,
            },
            bundling: {
                externalModules: ['aws-sdk'], // Use AWS SDK from Lambda runtime
                minify: true,
                sourceMap: true,
                target: 'es2020',
                format: lambdaNodejs.OutputFormat.CJS,
            },
        };
        // TMDB Integration Lambda
        this.tmdbLambda = new lambdaNodejs.NodejsFunction(this, 'TMDBLambda', {
            ...commonLambdaProps,
            functionName: 'trinity-tmdb-handler',
            entry: path.join(__dirname, '../src/handlers/tmdb/index.ts'),
            description: 'TMDB API integration with Latin script filtering',
        });
        // Room Handler Lambda
        this.roomLambda = new lambdaNodejs.NodejsFunction(this, 'RoomLambda', {
            ...commonLambdaProps,
            functionName: 'trinity-room-handler',
            entry: path.join(__dirname, '../src/handlers/room/index.ts'),
            description: 'Room creation and joining logic',
            environment: {
                ...commonLambdaProps.environment,
                TMDB_LAMBDA_ARN: '', // Will be set after TMDB lambda is created
            },
        });
        // Vote Handler Lambda
        this.voteLambda = new lambdaNodejs.NodejsFunction(this, 'VoteLambda', {
            ...commonLambdaProps,
            functionName: 'trinity-vote-handler',
            entry: path.join(__dirname, '../src/handlers/vote/index.ts'),
            description: 'Vote processing and match detection',
        });
        // Match Handler Lambda
        this.matchLambda = new lambdaNodejs.NodejsFunction(this, 'MatchLambda', {
            ...commonLambdaProps,
            functionName: 'trinity-match-handler',
            entry: path.join(__dirname, '../src/handlers/match/index.ts'),
            description: 'Match creation and history management',
        });
        // Update Lambda environment variables with cross-references
        this.roomLambda.addEnvironment('TMDB_LAMBDA_ARN', this.tmdbLambda.functionArn);
        this.voteLambda.addEnvironment('MATCH_LAMBDA_ARN', this.matchLambda.functionArn);
        // Grant DynamoDB permissions
        this.grantDynamoDBPermissions();
        // Grant Lambda invoke permissions
        this.grantLambdaPermissions();
    }
    grantDynamoDBPermissions() {
        // Grant read/write permissions to all tables for all lambdas
        const lambdas = [this.tmdbLambda, this.roomLambda, this.voteLambda, this.matchLambda];
        const tables = [this.roomsTable, this.votesTable, this.matchesTable, this.usersTable];
        lambdas.forEach(lambdaFn => {
            tables.forEach(table => {
                table.grantReadWriteData(lambdaFn);
            });
        });
    }
    grantLambdaPermissions() {
        // Allow Room Lambda to invoke TMDB Lambda
        this.tmdbLambda.grantInvoke(this.roomLambda);
        // Allow Vote Lambda to invoke Match Lambda
        this.matchLambda.grantInvoke(this.voteLambda);
    }
    createResolvers() {
        // Create Lambda data sources
        const roomDataSource = this.api.addLambdaDataSource('RoomDataSource', this.roomLambda);
        const voteDataSource = this.api.addLambdaDataSource('VoteDataSource', this.voteLambda);
        const matchDataSource = this.api.addLambdaDataSource('MatchDataSource', this.matchLambda);
        // Mutation Resolvers
        // createRoom mutation
        roomDataSource.createResolver('CreateRoomResolver', {
            typeName: 'Mutation',
            fieldName: 'createRoom',
            requestMappingTemplate: appsync.MappingTemplate.fromString(`
        {
          "version": "2017-02-28",
          "operation": "Invoke",
          "payload": {
            "operation": "createRoom",
            "userId": "$context.identity.sub",
            "input": $util.toJson($context.arguments.input)
          }
        }
      `),
            responseMappingTemplate: appsync.MappingTemplate.fromString(`
        #if($context.error)
          $util.error($context.error.message, $context.error.type)
        #end
        #if($context.result.statusCode == 200)
          $util.toJson($context.result.body)
        #else
          $util.error($context.result.body.error, "BadRequest")
        #end
      `),
        });
        // joinRoom mutation
        roomDataSource.createResolver('JoinRoomResolver', {
            typeName: 'Mutation',
            fieldName: 'joinRoom',
            requestMappingTemplate: appsync.MappingTemplate.fromString(`
        {
          "version": "2017-02-28",
          "operation": "Invoke",
          "payload": {
            "operation": "joinRoom",
            "userId": "$context.identity.sub",
            "code": "$context.arguments.code"
          }
        }
      `),
            responseMappingTemplate: appsync.MappingTemplate.fromString(`
        #if($context.error)
          $util.error($context.error.message, $context.error.type)
        #end
        #if($context.result.statusCode == 200)
          $util.toJson($context.result.body)
        #else
          $util.error($context.result.body.error, "BadRequest")
        #end
      `),
        });
        // vote mutation
        voteDataSource.createResolver('VoteResolver', {
            typeName: 'Mutation',
            fieldName: 'vote',
            requestMappingTemplate: appsync.MappingTemplate.fromString(`
        {
          "version": "2017-02-28",
          "operation": "Invoke",
          "payload": {
            "operation": "vote",
            "userId": "$context.identity.sub",
            "input": $util.toJson($context.arguments.input)
          }
        }
      `),
            responseMappingTemplate: appsync.MappingTemplate.fromString(`
        #if($context.error)
          $util.error($context.error.message, $context.error.type)
        #end
        #if($context.result.statusCode == 200)
          $util.toJson($context.result.body)
        #else
          $util.error($context.result.body.error, "BadRequest")
        #end
      `),
        });
        // Query Resolvers
        // getRoom query - reuse room data source
        roomDataSource.createResolver('GetRoomResolver', {
            typeName: 'Query',
            fieldName: 'getRoom',
            requestMappingTemplate: appsync.MappingTemplate.fromString(`
        {
          "version": "2017-02-28",
          "operation": "Invoke",
          "payload": {
            "operation": "getRoom",
            "userId": "$context.identity.sub",
            "roomId": "$context.arguments.id"
          }
        }
      `),
            responseMappingTemplate: appsync.MappingTemplate.fromString(`
        #if($context.error)
          $util.error($context.error.message, $context.error.type)
        #end
        #if($context.result.statusCode == 200)
          $util.toJson($context.result.body)
        #else
          $util.error($context.result.body.error, "BadRequest")
        #end
      `),
        });
        // getMyMatches query
        matchDataSource.createResolver('GetMyMatchesResolver', {
            typeName: 'Query',
            fieldName: 'getMyMatches',
            requestMappingTemplate: appsync.MappingTemplate.fromString(`
        {
          "version": "2017-02-28",
          "operation": "Invoke",
          "payload": {
            "operation": "getUserMatches",
            "userId": "$context.identity.sub"
          }
        }
      `),
            responseMappingTemplate: appsync.MappingTemplate.fromString(`
        #if($context.error)
          $util.error($context.error.message, $context.error.type)
        #end
        #if($context.result.statusCode == 200)
          $util.toJson($context.result.body.matches)
        #else
          $util.error($context.result.body.error, "BadRequest")
        #end
      `),
        });
        console.log('AppSync resolvers created successfully');
    }
    createOutputs() {
        // Output values needed for mobile app configuration
        new cdk.CfnOutput(this, 'UserPoolId', {
            value: this.userPool.userPoolId,
            description: 'Cognito User Pool ID',
            exportName: 'TrinityUserPoolId',
        });
        new cdk.CfnOutput(this, 'UserPoolClientId', {
            value: this.userPoolClient.userPoolClientId,
            description: 'Cognito User Pool Client ID',
            exportName: 'TrinityUserPoolClientId',
        });
        new cdk.CfnOutput(this, 'GraphQLEndpoint', {
            value: this.api.graphqlUrl,
            description: 'AppSync GraphQL API Endpoint',
            exportName: 'TrinityGraphQLEndpoint',
        });
        new cdk.CfnOutput(this, 'AWSRegion', {
            value: this.region,
            description: 'AWS Region',
            exportName: 'TrinityAWSRegion',
        });
        // Table names for Lambda functions
        new cdk.CfnOutput(this, 'RoomsTableName', {
            value: this.roomsTable.tableName,
            description: 'DynamoDB Rooms Table Name',
        });
        new cdk.CfnOutput(this, 'VotesTableName', {
            value: this.votesTable.tableName,
            description: 'DynamoDB Votes Table Name',
        });
        new cdk.CfnOutput(this, 'MatchesTableName', {
            value: this.matchesTable.tableName,
            description: 'DynamoDB Matches Table Name',
        });
        new cdk.CfnOutput(this, 'UsersTableName', {
            value: this.usersTable.tableName,
            description: 'DynamoDB Users Table Name',
        });
    }
}
exports.TrinityStack = TrinityStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidHJpbml0eS1zdGFjay5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uL3RyaW5pdHktc3RhY2sudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBQUEsaURBQW1DO0FBQ25DLG1FQUFxRDtBQUNyRCxpRUFBbUQ7QUFDbkQsaUVBQW1EO0FBQ25ELCtEQUFpRDtBQUNqRCw0RUFBOEQ7QUFHOUQsMkNBQTZCO0FBRTdCLE1BQWEsWUFBYSxTQUFRLEdBQUcsQ0FBQyxLQUFLO0lBZXpDLFlBQVksS0FBZ0IsRUFBRSxFQUFVLEVBQUUsS0FBc0I7UUFDOUQsS0FBSyxDQUFDLEtBQUssRUFBRSxFQUFFLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFFeEIseUJBQXlCO1FBQ3pCLElBQUksQ0FBQyxvQkFBb0IsRUFBRSxDQUFDO1FBRTVCLDJCQUEyQjtRQUMzQixJQUFJLENBQUMscUJBQXFCLEVBQUUsQ0FBQztRQUU3Qiw2QkFBNkI7UUFDN0IsSUFBSSxDQUFDLGdCQUFnQixFQUFFLENBQUM7UUFFeEIsMEJBQTBCO1FBQzFCLElBQUksQ0FBQyxxQkFBcUIsRUFBRSxDQUFDO1FBRTdCLDJCQUEyQjtRQUMzQixJQUFJLENBQUMsZUFBZSxFQUFFLENBQUM7UUFFdkIsMEJBQTBCO1FBQzFCLElBQUksQ0FBQyxhQUFhLEVBQUUsQ0FBQztJQUN2QixDQUFDO0lBRU8sb0JBQW9CO1FBQzFCLHFCQUFxQjtRQUNyQixJQUFJLENBQUMsVUFBVSxHQUFHLElBQUksUUFBUSxDQUFDLEtBQUssQ0FBQyxJQUFJLEVBQUUsY0FBYyxFQUFFO1lBQ3pELFNBQVMsRUFBRSxjQUFjO1lBQ3pCLFlBQVksRUFBRTtnQkFDWixJQUFJLEVBQUUsSUFBSTtnQkFDVixJQUFJLEVBQUUsUUFBUSxDQUFDLGFBQWEsQ0FBQyxNQUFNO2FBQ3BDO1lBQ0QsV0FBVyxFQUFFLFFBQVEsQ0FBQyxXQUFXLENBQUMsZUFBZTtZQUNqRCxhQUFhLEVB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RUFBRSwyQkFBMkI7U0FDekMsQ0FBQyxDQUFDO0lBQ0wsQ0FBQztDQUNGO0FBNWNELG9DQTRjQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCAqIGFzIGNkayBmcm9tICdhd3MtY2RrLWxpYic7XHJcbmltcG9ydCAqIGFzIGR5bmFtb2RiIGZyb20gJ2F3cy1jZGstbGliL2F3cy1keW5hbW9kYic7XHJcbmltcG9ydCAqIGFzIGNvZ25pdG8gZnJvbSAnYXdzLWNkay1saWIvYXdzLWNvZ25pdG8nO1xyXG5pbXBvcnQgKiBhcyBhcHBzeW5jIGZyb20gJ2F3cy1jZGstbGliL2F3cy1hcHBzeW5jJztcclxuaW1wb3J0ICogYXMgbGFtYmRhIGZyb20gJ2F3cy1jZGstbGliL2F3cy1sYW1iZGEnO1xyXG5pbXBvcnQgKiBhcyBsYW1iZGFOb2RlanMgZnJvbSAnYXdzLWNkay1saWIvYXdzLWxhbWJkYS1ub2RlanMnO1xyXG5pbXBvcnQgKiBhcyBpYW0gZnJvbSAnYXdzLWNkay1saWIvYXdzLWlhbSc7XHJcbmltcG9ydCB7IENvbnN0cnVjdCB9IGZyb20gJ2NvbnN0cnVjdHMnO1xyXG5pbXBvcnQgKiBhcyBwYXRoIGZyb20gJ3BhdGgnO1xyXG5cclxuZXhwb3J0IGNsYXNzIFRyaW5pdHlTdGFjayBleHRlbmRzIGNkay5TdGFjayB7XHJcbiAgcHVibGljIHVzZXJQb29sOiBjb2duaXRvLlVzZXJQb29sO1xyXG4gIHB1YmxpYyB1c2VyUG9vbENsaWVudDogY29nbml0by5Vc2VyUG9vbENsaWVudDtcclxuICBwdWJsaWMgYXBpOiBhcHBzeW5jLkdyYXBocWxBcGk7XHJcbiAgcHVibGljIHJvb21zVGFibGU6IGR5bmFtb2RiLlRhYmxlO1xyXG4gIHB1YmxpYyB2b3Rlc1RhYmxlOiBkeW5hbW9kYi5UYWJsZTtcclxuICBwdWJsaWMgbWF0Y2hlc1RhYmxlOiBkeW5hbW9kYi5UYWJsZTtcclxuICBwdWJsaWMgdXNlcnNUYWJsZTogZHluYW1vZGIuVGFibGU7XHJcbiAgXHJcbiAgLy8gTGFtYmRhIEZ1bmN0aW9uc1xyXG4gIHB1YmxpYyB0bWRiTGFtYmRhOiBsYW1iZGFOb2RlanMuTm9kZWpzRnVuY3Rpb247XHJcbiAgcHVibGljIHJvb21MYW1iZGE6IGxhbWJkYU5vZGVqcy5Ob2RlanNGdW5jdGlvbjtcclxuICBwdWJsaWMgdm90ZUxhbWJkYTogbGFtYmRhTm9kZWpzLk5vZGVqc0Z1bmN0aW9uO1xyXG4gIHB1YmxpYyBtYXRjaExhbWJkYTogbGFtYmRhTm9kZWpzLk5vZGVqc0Z1bmN0aW9uO1xyXG5cclxuICBjb25zdHJ1Y3RvcihzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nLCBwcm9wcz86IGNkay5TdGFja1Byb3BzKSB7XHJcbiAgICBzdXBlcihzY29wZSwgaWQsIHByb3BzKTtcclxuXHJcbiAgICAvLyBDcmVhdGUgRHluYW1vREIgVGFibGVzXHJcbiAgICB0aGlzLmNyZWF0ZUR5bmFtb0RCVGFibGVzKCk7XHJcbiAgICBcclxuICAgIC8vIENyZWF0ZSBDb2duaXRvIFVzZXIgUG9vbFxyXG4gICAgdGhpcy5jcmVhdGVDb2duaXRvVXNlclBvb2woKTtcclxuICAgIFxyXG4gICAgLy8gQ3JlYXRlIEFwcFN5bmMgR3JhcGhRTCBBUElcclxuICAgIHRoaXMuY3JlYXRlQXBwU3luY0FQSSgpO1xyXG4gICAgXHJcbiAgICAvLyBDcmVhdGUgTGFtYmRhIEZ1bmN0aW9uc1xyXG4gICAgdGhpcy5jcmVhdGVMYW1iZGFGdW5jdGlvbnMoKTtcclxuICAgIFxyXG4gICAgLy8gQ3JlYXRlIEFwcFN5bmMgUmVzb2x2ZXJzXHJcbiAgICB0aGlzLmNyZWF0ZVJlc29sdmVycygpO1xyXG5cclxuICAgIC8vIE91dHB1dCBpbXBvcnRhbnQgdmFsdWVzXHJcbiAgICB0aGlzLmNyZWF0ZU91dHB1dHMoKTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgY3JlYXRlRHluYW1vREJUYWJsZXMoKSB7XHJcbiAgICAvLyBUcmluaXR5Um9vbXMgVGFibGVcclxuICAgIHRoaXMucm9vbXNUYWJsZSA9IG5ldyBkeW5hbW9kYi5UYWJsZSh0aGlzLCAnVHJpbml0eVJvb21zJywge1xyXG4gICAgICB0YWJsZU5hbWU6ICdUcmluaXR5Um9vbXMnLFxyXG4gICAgICBwYXJ0aXRpb25LZXk6IHtcclxuICAgICAgICBuYW1lOiAnaWQnLFxyXG4gICAgICAgIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HLFxyXG4gICAgICB9LFxyXG4gICAgICBiaWxsaW5nTW9kZTogZHluYW1vZGIuQmlsbGluZ01vZGUuUEFZX1BFUl9SRVFVRVNULFxyXG4gICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLCAvLyBGb3IgZGV2ZWxvcG1lbnRcclxuICAgICAgcG9pbnRJblRpbWVSZWNvdmVyeTogdHJ1ZSxcclxuICAgICAgdGltZVRvTGl2ZUF0dHJpYnV0ZTogJ3R0bCcsXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBHbG9iYWwgU2Vjb25kYXJ5IEluZGV4IGZvciByb29tIGNvZGUgbG9va3VwXHJcbiAgICB0aGlzLnJvb21zVGFibGUuYWRkR2xvYmFsU2Vjb25kYXJ5SW5kZXgoe1xyXG4gICAgICBpbmRleE5hbWU6ICdjb2RlLWluZGV4JyxcclxuICAgICAgcGFydGl0aW9uS2V5OiB7XHJcbiAgICAgICAgbmFtZTogJ2NvZGUnLFxyXG4gICAgICAgIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HLFxyXG4gICAgICB9LFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gVHJpbml0eVZvdGVzIFRhYmxlXHJcbiAgICB0aGlzLnZvdGVzVGFibGUgPSBuZXcgZHluYW1vZGIuVGFibGUodGhpcywgJ1RyaW5pdHlWb3RlcycsIHtcclxuICAgICAgdGFibGVOYW1lOiAnVHJpbml0eVZvdGVzJyxcclxuICAgICAgcGFydGl0aW9uS2V5OiB7XHJcbiAgICAgICAgbmFtZTogJ3Jvb21JZCcsXHJcbiAgICAgICAgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcsXHJcbiAgICAgIH0sXHJcbiAgICAgIHNvcnRLZXk6IHtcclxuICAgICAgICBuYW1lOiAndXNlck1vdmllSWQnLFxyXG4gICAgICAgIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HLFxyXG4gICAgICB9LFxyXG4gICAgICBiaWxsaW5nTW9kZTogZHluYW1vZGIuQmlsbGluZ01vZGUuUEFZX1BFUl9SRVFVRVNULFxyXG4gICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLFxyXG4gICAgICBwb2ludEluVGltZVJlY292ZXJ5OiB0cnVlLFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gVHJpbml0eU1hdGNoZXMgVGFibGVcclxuICAgIHRoaXMubWF0Y2hlc1RhYmxlID0gbmV3IGR5bmFtb2RiLlRhYmxlKHRoaXMsICdUcmluaXR5TWF0Y2hlcycsIHtcclxuICAgICAgdGFibGVOYW1lOiAnVHJpbml0eU1hdGNoZXMnLFxyXG4gICAgICBwYXJ0aXRpb25LZXk6IHtcclxuICAgICAgICBuYW1lOiAncm9vbUlkJyxcclxuICAgICAgICB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyxcclxuICAgICAgfSxcclxuICAgICAgc29ydEtleToge1xyXG4gICAgICAgIG5hbWU6ICdtb3ZpZUlkJyxcclxuICAgICAgICB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLk5VTUJFUixcclxuICAgICAgfSxcclxuICAgICAgYmlsbGluZ01vZGU6IGR5bmFtb2RiLkJpbGxpbmdNb2RlLlBBWV9QRVJfUkVRVUVTVCxcclxuICAgICAgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuREVTVFJPWSxcclxuICAgICAgcG9pbnRJblRpbWVSZWNvdmVyeTogdHJ1ZSxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIExvY2FsIFNlY29uZGFyeSBJbmRleCBmb3IgdGltZXN0YW1wLWJhc2VkIHF1ZXJpZXNcclxuICAgIHRoaXMubWF0Y2hlc1RhYmxlLmFkZExvY2FsU2Vjb25kYXJ5SW5kZXgoe1xyXG4gICAgICBpbmRleE5hbWU6ICd0aW1lc3RhbXAtaW5kZXgnLFxyXG4gICAgICBzb3J0S2V5OiB7XHJcbiAgICAgICAgbmFtZTogJ3RpbWVzdGFtcCcsXHJcbiAgICAgICAgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcsXHJcbiAgICAgIH0sXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBUcmluaXR5VXNlcnMgVGFibGVcclxuICAgIHRoaXMudXNlcnNUYWJsZSA9IG5ldyBkeW5hbW9kYi5UYWJsZSh0aGlzLCAnVHJpbml0eVVzZXJzJywge1xyXG4gICAgICB0YWJsZU5hbWU6ICdUcmluaXR5VXNlcnMnLFxyXG4gICAgICBwYXJ0aXRpb25LZXk6IHtcclxuICAgICAgICBuYW1lOiAnaWQnLFxyXG4gICAgICAgIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HLFxyXG4gICAgICB9LFxyXG4gICAgICBiaWxsaW5nTW9kZTogZHluYW1vZGIuQmlsbGluZ01vZGUuUEFZX1BFUl9SRVFVRVNULFxyXG4gICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLFxyXG4gICAgICBwb2ludEluVGltZVJlY292ZXJ5OiB0cnVlLFxyXG4gICAgfSk7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGNyZWF0ZUNvZ25pdG9Vc2VyUG9vbCgpIHtcclxuICAgIC8vIENyZWF0ZSBVc2VyIFBvb2xcclxuICAgIHRoaXMudXNlclBvb2wgPSBuZXcgY29nbml0by5Vc2VyUG9vbCh0aGlzLCAnVHJpbml0eVVzZXJQb29sJywge1xyXG4gICAgICB1c2VyUG9vbE5hbWU6ICd0cmluaXR5LXVzZXItcG9vbCcsXHJcbiAgICAgIHNlbGZTaWduVXBFbmFibGVkOiB0cnVlLFxyXG4gICAgICBzaWduSW5BbGlhc2VzOiB7XHJcbiAgICAgICAgZW1haWw6IHRydWUsXHJcbiAgICAgIH0sXHJcbiAgICAgIGF1dG9WZXJpZnk6IHtcclxuICAgICAgICBlbWFpbDogdHJ1ZSxcclxuICAgICAgfSxcclxuICAgICAgc3RhbmRhcmRBdHRyaWJ1dGVzOiB7XHJcbiAgICAgICAgZW1haWw6IHtcclxuICAgICAgICAgIHJlcXVpcmVkOiB0cnVlLFxyXG4gICAgICAgICAgbXV0YWJsZTogdHJ1ZSxcclxuICAgICAgICB9LFxyXG4gICAgICB9LFxyXG4gICAgICBwYXNzd29yZFBvbGljeToge1xyXG4gICAgICAgIG1pbkxlbmd0aDogOCxcclxuICAgICAgICByZXF1aXJlTG93ZXJjYXNlOiB0cnVlLFxyXG4gICAgICAgIHJlcXVpcmVVcHBlcmNhc2U6IHRydWUsXHJcbiAgICAgICAgcmVxdWlyZURpZ2l0czogdHJ1ZSxcclxuICAgICAgICByZXF1aXJlU3ltYm9sczogZmFsc2UsXHJcbiAgICAgIH0sXHJcbiAgICAgIGFjY291bnRSZWNvdmVyeTogY29nbml0by5BY2NvdW50UmVjb3ZlcnkuRU1BSUxfT05MWSxcclxuICAgICAgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuREVTVFJPWSxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIENyZWF0ZSBVc2VyIFBvb2wgQ2xpZW50XHJcbiAgICB0aGlzLnVzZXJQb29sQ2xpZW50ID0gbmV3IGNvZ25pdG8uVXNlclBvb2xDbGllbnQodGhpcywgJ1RyaW5pdHlVc2VyUG9vbENsaWVudCcsIHtcclxuICAgICAgdXNlclBvb2w6IHRoaXMudXNlclBvb2wsXHJcbiAgICAgIHVzZXJQb29sQ2xpZW50TmFtZTogJ3RyaW5pdHktbW9iaWxlLWNsaWVudCcsXHJcbiAgICAgIGdlbmVyYXRlU2VjcmV0OiBmYWxzZSwgLy8gUmVxdWlyZWQgZm9yIG1vYmlsZSBhcHBzXHJcbiAgICAgIGF1dGhGbG93czoge1xyXG4gICAgICAgIHVzZXJTcnA6IHRydWUsXHJcbiAgICAgICAgdXNlclBhc3N3b3JkOiB0cnVlLFxyXG4gICAgICB9LFxyXG4gICAgICBwcmV2ZW50VXNlckV4aXN0ZW5jZUVycm9yczogdHJ1ZSxcclxuICAgIH0pO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBjcmVhdGVBcHBTeW5jQVBJKCkge1xyXG4gICAgLy8gQ3JlYXRlIEFwcFN5bmMgR3JhcGhRTCBBUElcclxuICAgIHRoaXMuYXBpID0gbmV3IGFwcHN5bmMuR3JhcGhxbEFwaSh0aGlzLCAnVHJpbml0eUFQSScsIHtcclxuICAgICAgbmFtZTogJ3RyaW5pdHktYXBpJyxcclxuICAgICAgZGVmaW5pdGlvbjogYXBwc3luYy5EZWZpbml0aW9uLmZyb21GaWxlKHBhdGguam9pbihfX2Rpcm5hbWUsICcuLi9zY2hlbWEuZ3JhcGhxbCcpKSxcclxuICAgICAgYXV0aG9yaXphdGlvbkNvbmZpZzoge1xyXG4gICAgICAgIGRlZmF1bHRBdXRob3JpemF0aW9uOiB7XHJcbiAgICAgICAgICBhdXRob3JpemF0aW9uVHlwZTogYXBwc3luYy5BdXRob3JpemF0aW9uVHlwZS5VU0VSX1BPT0wsXHJcbiAgICAgICAgICB1c2VyUG9vbENvbmZpZzoge1xyXG4gICAgICAgICAgICB1c2VyUG9vbDogdGhpcy51c2VyUG9vbCxcclxuICAgICAgICAgIH0sXHJcbiAgICAgICAgfSxcclxuICAgICAgfSxcclxuICAgICAgbG9nQ29uZmlnOiB7XHJcbiAgICAgICAgZmllbGRMb2dMZXZlbDogYXBwc3luYy5GaWVsZExvZ0xldmVsLkFMTCxcclxuICAgICAgfSxcclxuICAgICAgeHJheUVuYWJsZWQ6IHRydWUsXHJcbiAgICB9KTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgY3JlYXRlTGFtYmRhRnVuY3Rpb25zKCkge1xyXG4gICAgLy8gQ29tbW9uIExhbWJkYSBjb25maWd1cmF0aW9uXHJcbiAgICBjb25zdCBjb21tb25MYW1iZGFQcm9wcyA9IHtcclxuICAgICAgcnVudGltZTogbGFtYmRhLlJ1bnRpbWUuTk9ERUpTXzIwX1gsXHJcbiAgICAgIHRpbWVvdXQ6IGNkay5EdXJhdGlvbi5zZWNvbmRzKDMwKSxcclxuICAgICAgbWVtb3J5U2l6ZTogNTEyLFxyXG4gICAgICBlbnZpcm9ubWVudDoge1xyXG4gICAgICAgIFRNREJfQVBJX0tFWTogcHJvY2Vzcy5lbnYuVE1EQl9BUElfS0VZIHx8ICcnLFxyXG4gICAgICAgIFRNREJfUkVBRF9UT0tFTjogcHJvY2Vzcy5lbnYuVE1EQl9SRUFEX1RPS0VOIHx8ICcnLFxyXG4gICAgICAgIFRNREJfQkFTRV9VUkw6IHByb2Nlc3MuZW52LlRNREJfQkFTRV9VUkwgfHwgJ2h0dHBzOi8vYXBpLnRoZW1vdmllZGIub3JnLzMnLFxyXG4gICAgICAgIFJPT01TX1RBQkxFOiB0aGlzLnJvb21zVGFibGUudGFibGVOYW1lLFxyXG4gICAgICAgIFZPVEVTX1RBQkxFOiB0aGlzLnZvdGVzVGFibGUudGFibGVOYW1lLFxyXG4gICAgICAgIE1BVENIRVNfVEFCTEU6IHRoaXMubWF0Y2hlc1RhYmxlLnRhYmxlTmFtZSxcclxuICAgICAgICBVU0VSU19UQUJMRTogdGhpcy51c2Vyc1RhYmxlLnRhYmxlTmFtZSxcclxuICAgICAgfSxcclxuICAgICAgYnVuZGxpbmc6IHtcclxuICAgICAgICBleHRlcm5hbE1vZHVsZXM6IFsnYXdzLXNkayddLCAvLyBVc2UgQVdTIFNESyBmcm9tIExhbWJkYSBydW50aW1lXHJcbiAgICAgICAgbWluaWZ5OiB0cnVlLFxyXG4gICAgICAgIHNvdXJjZU1hcDogdHJ1ZSxcclxuICAgICAgICB0YXJnZXQ6ICdlczIwMjAnLFxyXG4gICAgICAgIGZvcm1hdDogbGFtYmRhTm9kZWpzLk91dHB1dEZvcm1hdC5DSlMsXHJcbiAgICAgIH0sXHJcbiAgICB9O1xyXG5cclxuICAgIC8vIFRNREIgSW50ZWdyYXRpb24gTGFtYmRhXHJcbiAgICB0aGlzLnRtZGJMYW1iZGEgPSBuZXcgbGFtYmRhTm9kZWpzLk5vZGVqc0Z1bmN0aW9uKHRoaXMsICdUTURCTGFtYmRhJywge1xyXG4gICAgICAuLi5jb21tb25MYW1iZGFQcm9wcyxcclxuICAgICAgZnVuY3Rpb25OYW1lOiAndHJpbml0eS10bWRiLWhhbmRsZXInLFxyXG4gICAgICBlbnRyeTogcGF0aC5qb2luKF9fZGlybmFtZSwgJy4uL3NyYy9oYW5kbGVycy90bWRiL2luZGV4LnRzJyksXHJcbiAgICAgIGRlc2NyaXB0aW9uOiAnVE1EQiBBUEkgaW50ZWdyYXRpb24gd2l0aCBMYXRpbiBzY3JpcHQgZmlsdGVyaW5nJyxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIFJvb20gSGFuZGxlciBMYW1iZGFcclxuICAgIHRoaXMucm9vbUxhbWJkYSA9IG5ldyBsYW1iZGFOb2RlanMuTm9kZWpzRnVuY3Rpb24odGhpcywgJ1Jvb21MYW1iZGEnLCB7XHJcbiAgICAgIC4uLmNvbW1vbkxhbWJkYVByb3BzLFxyXG4gICAgICBmdW5jdGlvbk5hbWU6ICd0cmluaXR5LXJvb20taGFuZGxlcicsXHJcbiAgICAgIGVudHJ5OiBwYXRoLmpvaW4oX19kaXJuYW1lLCAnLi4vc3JjL2hhbmRsZXJzL3Jvb20vaW5kZXgudHMnKSxcclxuICAgICAgZGVzY3JpcHRpb246ICdSb29tIGNyZWF0aW9uIGFuZCBqb2luaW5nIGxvZ2ljJyxcclxuICAgICAgZW52aXJvbm1lbnQ6IHtcclxuICAgICAgICAuLi5jb21tb25MYW1iZGFQcm9wcy5lbnZpcm9ubWVudCxcclxuICAgICAgICBUTURCX0xBTUJEQV9BUk46ICcnLCAvLyBXaWxsIGJlIHNldCBhZnRlciBUTURCIGxhbWJkYSBpcyBjcmVhdGVkXHJcbiAgICAgIH0sXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBWb3RlIEhhbmRsZXIgTGFtYmRhXHJcbiAgICB0aGlzLnZvdGVMYW1iZGEgPSBuZXcgbGFtYmRhTm9kZWpzLk5vZGVqc0Z1bmN0aW9uKHRoaXMsICdWb3RlTGFtYmRhJywge1xyXG4gICAgICAuLi5jb21tb25MYW1iZGFQcm9wcyxcclxuICAgICAgZnVuY3Rpb25OYW1lOiAndHJpbml0eS12b3RlLWhhbmRsZXInLFxyXG4gICAgICBlbnRyeTogcGF0aC5qb2luKF9fZGlybmFtZSwgJy4uL3NyYy9oYW5kbGVycy92b3RlL2luZGV4LnRzJyksXHJcbiAgICAgIGRlc2NyaXB0aW9uOiAnVm90ZSBwcm9jZXNzaW5nIGFuZCBtYXRjaCBkZXRlY3Rpb24nLFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gTWF0Y2ggSGFuZGxlciBMYW1iZGFcclxuICAgIHRoaXMubWF0Y2hMYW1iZGEgPSBuZXcgbGFtYmRhTm9kZWpzLk5vZGVqc0Z1bmN0aW9uKHRoaXMsICdNYXRjaExhbWJkYScsIHtcclxuICAgICAgLi4uY29tbW9uTGFtYmRhUHJvcHMsXHJcbiAgICAgIGZ1bmN0aW9uTmFtZTogJ3RyaW5pdHktbWF0Y2gtaGFuZGxlcicsXHJcbiAgICAgIGVudHJ5OiBwYXRoLmpvaW4oX19kaXJuYW1lLCAnLi4vc3JjL2hhbmRsZXJzL21hdGNoL2luZGV4LnRzJyksXHJcbiAgICAgIGRlc2NyaXB0aW9uOiAnTWF0Y2ggY3JlYXRpb24gYW5kIGhpc3RvcnkgbWFuYWdlbWVudCcsXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBVcGRhdGUgTGFtYmRhIGVudmlyb25tZW50IHZhcmlhYmxlcyB3aXRoIGNyb3NzLXJlZmVyZW5jZXNcclxuICAgIHRoaXMucm9vbUxhbWJkYS5hZGRFbnZpcm9ubWVudCgnVE1EQl9MQU1CREFfQVJOJywgdGhpcy50bWRiTGFtYmRhLmZ1bmN0aW9uQXJuKTtcclxuICAgIHRoaXMudm90ZUxhbWJkYS5hZGRFbnZpcm9ubWVudCgnTUFUQ0hfTEFNQkRBX0FSTicsIHRoaXMubWF0Y2hMYW1iZGEuZnVuY3Rpb25Bcm4pO1xyXG5cclxuICAgIC8vIEdyYW50IER5bmFtb0RCIHBlcm1pc3Npb25zXHJcbiAgICB0aGlzLmdyYW50RHluYW1vREJQZXJtaXNzaW9ucygpO1xyXG5cclxuICAgIC8vIEdyYW50IExhbWJkYSBpbnZva2UgcGVybWlzc2lvbnNcclxuICAgIHRoaXMuZ3JhbnRMYW1iZGFQZXJtaXNzaW9ucygpO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBncmFudER5bmFtb0RCUGVybWlzc2lvbnMoKSB7XHJcbiAgICAvLyBHcmFudCByZWFkL3dyaXRlIHBlcm1pc3Npb25zIHRvIGFsbCB0YWJsZXMgZm9yIGFsbCBsYW1iZGFzXHJcbiAgICBjb25zdCBsYW1iZGFzID0gW3RoaXMudG1kYkxhbWJkYSwgdGhpcy5yb29tTGFtYmRhLCB0aGlzLnZvdGVMYW1iZGEsIHRoaXMubWF0Y2hMYW1iZGFdO1xyXG4gICAgY29uc3QgdGFibGVzID0gW3RoaXMucm9vbXNUYWJsZSwgdGhpcy52b3Rlc1RhYmxlLCB0aGlzLm1hdGNoZXNUYWJsZSwgdGhpcy51c2Vyc1RhYmxlXTtcclxuXHJcbiAgICBsYW1iZGFzLmZvckVhY2gobGFtYmRhRm4gPT4ge1xyXG4gICAgICB0YWJsZXMuZm9yRWFjaCh0YWJsZSA9PiB7XHJcbiAgICAgICAgdGFibGUuZ3JhbnRSZWFkV3JpdGVEYXRhKGxhbWJkYUZuKTtcclxuICAgICAgfSk7XHJcbiAgICB9KTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgZ3JhbnRMYW1iZGFQZXJtaXNzaW9ucygpIHtcclxuICAgIC8vIEFsbG93IFJvb20gTGFtYmRhIHRvIGludm9rZSBUTURCIExhbWJkYVxyXG4gICAgdGhpcy50bWRiTGFtYmRhLmdyYW50SW52b2tlKHRoaXMucm9vbUxhbWJkYSk7XHJcbiAgICBcclxuICAgIC8vIEFsbG93IFZvdGUgTGFtYmRhIHRvIGludm9rZSBNYXRjaCBMYW1iZGFcclxuICAgIHRoaXMubWF0Y2hMYW1iZGEuZ3JhbnRJbnZva2UodGhpcy52b3RlTGFtYmRhKTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgY3JlYXRlUmVzb2x2ZXJzKCkge1xyXG4gICAgLy8gQ3JlYXRlIExhbWJkYSBkYXRhIHNvdXJjZXNcclxuICAgIGNvbnN0IHJvb21EYXRhU291cmNlID0gdGhpcy5hcGkuYWRkTGFtYmRhRGF0YVNvdXJjZSgnUm9vbURhdGFTb3VyY2UnLCB0aGlzLnJvb21MYW1iZGEpO1xyXG4gICAgY29uc3Qgdm90ZURhdGFTb3VyY2UgPSB0aGlzLmFwaS5hZGRMYW1iZGFEYXRhU291cmNlKCdWb3RlRGF0YVNvdXJjZScsIHRoaXMudm90ZUxhbWJkYSk7XHJcbiAgICBjb25zdCBtYXRjaERhdGFTb3VyY2UgPSB0aGlzLmFwaS5hZGRMYW1iZGFEYXRhU291cmNlKCdNYXRjaERhdGFTb3VyY2UnLCB0aGlzLm1hdGNoTGFtYmRhKTtcclxuXHJcbiAgICAvLyBNdXRhdGlvbiBSZXNvbHZlcnNcclxuICAgIFxyXG4gICAgLy8gY3JlYXRlUm9vbSBtdXRhdGlvblxyXG4gICAgcm9vbURhdGFTb3VyY2UuY3JlYXRlUmVzb2x2ZXIoJ0NyZWF0ZVJvb21SZXNvbHZlcicsIHtcclxuICAgICAgdHlwZU5hbWU6ICdNdXRhdGlvbicsXHJcbiAgICAgIGZpZWxkTmFtZTogJ2NyZWF0ZVJvb20nLFxyXG4gICAgICByZXF1ZXN0TWFwcGluZ1RlbXBsYXRlOiBhcHBzeW5jLk1hcHBpbmdUZW1wbGF0ZS5mcm9tU3RyaW5nKGBcclxuICAgICAgICB7XHJcbiAgICAgICAgICBcInZlcnNpb25cIjogXCIyMDE3LTAyLTI4XCIsXHJcbiAgICAgICAgICBcIm9wZXJhdGlvblwiOiBcIkludm9rZVwiLFxyXG4gICAgICAgICAgXCJwYXlsb2FkXCI6IHtcclxuICAgICAgICAgICAgXCJvcGVyYXRpb25cIjogXCJjcmVhdGVSb29tXCIsXHJcbiAgICAgICAgICAgIFwidXNlcklkXCI6IFwiJGNvbnRleHQuaWRlbnRpdHkuc3ViXCIsXHJcbiAgICAgICAgICAgIFwiaW5wdXRcIjogJHV0aWwudG9Kc29uKCRjb250ZXh0LmFyZ3VtZW50cy5pbnB1dClcclxuICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICAgIGApLFxyXG4gICAgICByZXNwb25zZU1hcHBpbmdUZW1wbGF0ZTogYXBwc3luYy5NYXBwaW5nVGVtcGxhdGUuZnJvbVN0cmluZyhgXHJcbiAgICAgICAgI2lmKCRjb250ZXh0LmVycm9yKVxyXG4gICAgICAgICAgJHV0aWwuZXJyb3IoJGNvbnRleHQuZXJyb3IubWVzc2FnZSwgJGNvbnRleHQuZXJyb3IudHlwZSlcclxuICAgICAgICAjZW5kXHJcbiAgICAgICAgI2lmKCRjb250ZXh0LnJlc3VsdC5zdGF0dXNDb2RlID09IDIwMClcclxuICAgICAgICAgICR1dGlsLnRvSnNvbigkY29udGV4dC5yZXN1bHQuYm9keSlcclxuICAgICAgICAjZWxzZVxyXG4gICAgICAgICAgJHV0aWwuZXJyb3IoJGNvbnRleHQucmVzdWx0LmJvZHkuZXJyb3IsIFwiQmFkUmVxdWVzdFwiKVxyXG4gICAgICAgICNlbmRcclxuICAgICAgYCksXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBqb2luUm9vbSBtdXRhdGlvblxyXG4gICAgcm9vbURhdGFTb3VyY2UuY3JlYXRlUmVzb2x2ZXIoJ0pvaW5Sb29tUmVzb2x2ZXInLCB7XHJcbiAgICAgIHR5cGVOYW1lOiAnTXV0YXRpb24nLFxyXG4gICAgICBmaWVsZE5hbWU6ICdqb2luUm9vbScsXHJcbiAgICAgIHJlcXVlc3RNYXBwaW5nVGVtcGxhdGU6IGFwcHN5bmMuTWFwcGluZ1RlbXBsYXRlLmZyb21TdHJpbmcoYFxyXG4gICAgICAgIHtcclxuICAgICAgICAgIFwidmVyc2lvblwiOiBcIjIwMTctMDItMjhcIixcclxuICAgICAgICAgIFwib3BlcmF0aW9uXCI6IFwiSW52b2tlXCIsXHJcbiAgICAgICAgICBcInBheWxvYWRcIjoge1xyXG4gICAgICAgICAgICBcIm9wZXJhdGlvblwiOiBcImpvaW5Sb29tXCIsXHJcbiAgICAgICAgICAgIFwidXNlcklkXCI6IFwiJGNvbnRleHQuaWRlbnRpdHkuc3ViXCIsXHJcbiAgICAgICAgICAgIFwiY29kZVwiOiBcIiRjb250ZXh0LmFyZ3VtZW50cy5jb2RlXCJcclxuICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICAgIGApLFxyXG4gICAgICByZXNwb25zZU1hcHBpbmdUZW1wbGF0ZTogYXBwc3luYy5NYXBwaW5nVGVtcGxhdGUuZnJvbVN0cmluZyhgXHJcbiAgICAgICAgI2lmKCRjb250ZXh0LmVycm9yKVxyXG4gICAgICAgICAgJHV0aWwuZXJyb3IoJGNvbnRleHQuZXJyb3IubWVzc2FnZSwgJGNvbnRleHQuZXJyb3IudHlwZSlcclxuICAgICAgICAjZW5kXHJcbiAgICAgICAgI2lmKCRjb250ZXh0LnJlc3VsdC5zdGF0dXNDb2RlID09IDIwMClcclxuICAgICAgICAgICR1dGlsLnRvSnNvbigkY29udGV4dC5yZXN1bHQuYm9keSlcclxuICAgICAgICAjZWxzZVxyXG4gICAgICAgICAgJHV0aWwuZXJyb3IoJGNvbnRleHQucmVzdWx0LmJvZHkuZXJyb3IsIFwiQmFkUmVxdWVzdFwiKVxyXG4gICAgICAgICNlbmRcclxuICAgICAgYCksXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyB2b3RlIG11dGF0aW9uXHJcbiAgICB2b3RlRGF0YVNvdXJjZS5jcmVhdGVSZXNvbHZlcignVm90ZVJlc29sdmVyJywge1xyXG4gICAgICB0eXBlTmFtZTogJ011dGF0aW9uJyxcclxuICAgICAgZmllbGROYW1lOiAndm90ZScsXHJcbiAgICAgIHJlcXVlc3RNYXBwaW5nVGVtcGxhdGU6IGFwcHN5bmMuTWFwcGluZ1RlbXBsYXRlLmZyb21TdHJpbmcoYFxyXG4gICAgICAgIHtcclxuICAgICAgICAgIFwidmVyc2lvblwiOiBcIjIwMTctMDItMjhcIixcclxuICAgICAgICAgIFwib3BlcmF0aW9uXCI6IFwiSW52b2tlXCIsXHJcbiAgICAgICAgICBcInBheWxvYWRcIjoge1xyXG4gICAgICAgICAgICBcIm9wZXJhdGlvblwiOiBcInZvdGVcIixcclxuICAgICAgICAgICAgXCJ1c2VySWRcIjogXCIkY29udGV4dC5pZGVudGl0eS5zdWJcIixcclxuICAgICAgICAgICAgXCJpbnB1dFwiOiAkdXRpbC50b0pzb24oJGNvbnRleHQuYXJndW1lbnRzLmlucHV0KVxyXG4gICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuICAgICAgYCksXHJcbiAgICAgIHJlc3BvbnNlTWFwcGluZ1RlbXBsYXRlOiBhcHBzeW5jLk1hcHBpbmdUZW1wbGF0ZS5mcm9tU3RyaW5nKGBcclxuICAgICAgICAjaWYoJGNvbnRleHQuZXJyb3IpXHJcbiAgICAgICAgICAkdXRpbC5lcnJvcigkY29udGV4dC5lcnJvci5tZXNzYWdlLCAkY29udGV4dC5lcnJvci50eXBlKVxyXG4gICAgICAgICNlbmRcclxuICAgICAgICAjaWYoJGNvbnRleHQucmVzdWx0LnN0YXR1c0NvZGUgPT0gMjAwKVxyXG4gICAgICAgICAgJHV0aWwudG9Kc29uKCRjb250ZXh0LnJlc3VsdC5ib2R5KVxyXG4gICAgICAgICNlbHNlXHJcbiAgICAgICAgICAkdXRpbC5lcnJvcigkY29udGV4dC5yZXN1bHQuYm9keS5lcnJvciwgXCJCYWRSZXF1ZXN0XCIpXHJcbiAgICAgICAgI2VuZFxyXG4gICAgICBgKSxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIFF1ZXJ5IFJlc29sdmVyc1xyXG5cclxuICAgIC8vIGdldFJvb20gcXVlcnkgLSByZXVzZSByb29tIGRhdGEgc291cmNlXHJcbiAgICByb29tRGF0YVNvdXJjZS5jcmVhdGVSZXNvbHZlcignR2V0Um9vbVJlc29sdmVyJywge1xyXG4gICAgICB0eXBlTmFtZTogJ1F1ZXJ5JyxcclxuICAgICAgZmllbGROYW1lOiAnZ2V0Um9vbScsXHJcbiAgICAgIHJlcXVlc3RNYXBwaW5nVGVtcGxhdGU6IGFwcHN5bmMuTWFwcGluZ1RlbXBsYXRlLmZyb21TdHJpbmcoYFxyXG4gICAgICAgIHtcclxuICAgICAgICAgIFwidmVyc2lvblwiOiBcIjIwMTctMDItMjhcIixcclxuICAgICAgICAgIFwib3BlcmF0aW9uXCI6IFwiSW52b2tlXCIsXHJcbiAgICAgICAgICBcInBheWxvYWRcIjoge1xyXG4gICAgICAgICAgICBcIm9wZXJhdGlvblwiOiBcImdldFJvb21cIixcclxuICAgICAgICAgICAgXCJ1c2VySWRcIjogXCIkY29udGV4dC5pZGVudGl0eS5zdWJcIixcclxuICAgICAgICAgICAgXCJyb29tSWRcIjogXCIkY29udGV4dC5hcmd1bWVudHMuaWRcIlxyXG4gICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuICAgICAgYCksXHJcbiAgICAgIHJlc3BvbnNlTWFwcGluZ1RlbXBsYXRlOiBhcHBzeW5jLk1hcHBpbmdUZW1wbGF0ZS5mcm9tU3RyaW5nKGBcclxuICAgICAgICAjaWYoJGNvbnRleHQuZXJyb3IpXHJcbiAgICAgICAgICAkdXRpbC5lcnJvcigkY29udGV4dC5lcnJvci5tZXNzYWdlLCAkY29udGV4dC5lcnJvci50eXBlKVxyXG4gICAgICAgICNlbmRcclxuICAgICAgICAjaWYoJGNvbnRleHQucmVzdWx0LnN0YXR1c0NvZGUgPT0gMjAwKVxyXG4gICAgICAgICAgJHV0aWwudG9Kc29uKCRjb250ZXh0LnJlc3VsdC5ib2R5KVxyXG4gICAgICAgICNlbHNlXHJcbiAgICAgICAgICAkdXRpbC5lcnJvcigkY29udGV4dC5yZXN1bHQuYm9keS5lcnJvciwgXCJCYWRSZXF1ZXN0XCIpXHJcbiAgICAgICAgI2VuZFxyXG4gICAgICBgKSxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIGdldE15TWF0Y2hlcyBxdWVyeVxyXG4gICAgbWF0Y2hEYXRhU291cmNlLmNyZWF0ZVJlc29sdmVyKCdHZXRNeU1hdGNoZXNSZXNvbHZlcicsIHtcclxuICAgICAgdHlwZU5hbWU6ICdRdWVyeScsXHJcbiAgICAgIGZpZWxkTmFtZTogJ2dldE15TWF0Y2hlcycsXHJcbiAgICAgIHJlcXVlc3RNYXBwaW5nVGVtcGxhdGU6IGFwcHN5bmMuTWFwcGluZ1RlbXBsYXRlLmZyb21TdHJpbmcoYFxyXG4gICAgICAgIHtcclxuICAgICAgICAgIFwidmVyc2lvblwiOiBcIjIwMTctMDItMjhcIixcclxuICAgICAgICAgIFwib3BlcmF0aW9uXCI6IFwiSW52b2tlXCIsXHJcbiAgICAgICAgICBcInBheWxvYWRcIjoge1xyXG4gICAgICAgICAgICBcIm9wZXJhdGlvblwiOiBcImdldFVzZXJNYXRjaGVzXCIsXHJcbiAgICAgICAgICAgIFwidXNlcklkXCI6IFwiJGNvbnRleHQuaWRlbnRpdHkuc3ViXCJcclxuICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICAgIGApLFxyXG4gICAgICByZXNwb25zZU1hcHBpbmdUZW1wbGF0ZTogYXBwc3luYy5NYXBwaW5nVGVtcGxhdGUuZnJvbVN0cmluZyhgXHJcbiAgICAgICAgI2lmKCRjb250ZXh0LmVycm9yKVxyXG4gICAgICAgICAgJHV0aWwuZXJyb3IoJGNvbnRleHQuZXJyb3IubWVzc2FnZSwgJGNvbnRleHQuZXJyb3IudHlwZSlcclxuICAgICAgICAjZW5kXHJcbiAgICAgICAgI2lmKCRjb250ZXh0LnJlc3VsdC5zdGF0dXNDb2RlID09IDIwMClcclxuICAgICAgICAgICR1dGlsLnRvSnNvbigkY29udGV4dC5yZXN1bHQuYm9keS5tYXRjaGVzKVxyXG4gICAgICAgICNlbHNlXHJcbiAgICAgICAgICAkdXRpbC5lcnJvcigkY29udGV4dC5yZXN1bHQuYm9keS5lcnJvciwgXCJCYWRSZXF1ZXN0XCIpXHJcbiAgICAgICAgI2VuZFxyXG4gICAgICBgKSxcclxuICAgIH0pO1xyXG5cclxuICAgIGNvbnNvbGUubG9nKCdBcHBTeW5jIHJlc29sdmVycyBjcmVhdGVkIHN1Y2Nlc3NmdWxseScpO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBjcmVhdGVPdXRwdXRzKCkge1xyXG4gICAgLy8gT3V0cHV0IHZhbHVlcyBuZWVkZWQgZm9yIG1vYmlsZSBhcHAgY29uZmlndXJhdGlvblxyXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ1VzZXJQb29sSWQnLCB7XHJcbiAgICAgIHZhbHVlOiB0aGlzLnVzZXJQb29sLnVzZXJQb29sSWQsXHJcbiAgICAgIGRlc2NyaXB0aW9uOiAnQ29nbml0byBVc2VyIFBvb2wgSUQnLFxyXG4gICAgICBleHBvcnROYW1lOiAnVHJpbml0eVVzZXJQb29sSWQnLFxyXG4gICAgfSk7XHJcblxyXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ1VzZXJQb29sQ2xpZW50SWQnLCB7XHJcbiAgICAgIHZhbHVlOiB0aGlzLnVzZXJQb29sQ2xpZW50LnVzZXJQb29sQ2xpZW50SWQsXHJcbiAgICAgIGRlc2NyaXB0aW9uOiAnQ29nbml0byBVc2VyIFBvb2wgQ2xpZW50IElEJyxcclxuICAgICAgZXhwb3J0TmFtZTogJ1RyaW5pdHlVc2VyUG9vbENsaWVudElkJyxcclxuICAgIH0pO1xyXG5cclxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdHcmFwaFFMRW5kcG9pbnQnLCB7XHJcbiAgICAgIHZhbHVlOiB0aGlzLmFwaS5ncmFwaHFsVXJsLFxyXG4gICAgICBkZXNjcmlwdGlvbjogJ0FwcFN5bmMgR3JhcGhRTCBBUEkgRW5kcG9pbnQnLFxyXG4gICAgICBleHBvcnROYW1lOiAnVHJpbml0eUdyYXBoUUxFbmRwb2ludCcsXHJcbiAgICB9KTtcclxuXHJcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnQVdTUmVnaW9uJywge1xyXG4gICAgICB2YWx1ZTogdGhpcy5yZWdpb24sXHJcbiAgICAgIGRlc2NyaXB0aW9uOiAnQVdTIFJlZ2lvbicsXHJcbiAgICAgIGV4cG9ydE5hbWU6ICdUcmluaXR5QVdTUmVnaW9uJyxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIFRhYmxlIG5hbWVzIGZvciBMYW1iZGEgZnVuY3Rpb25zXHJcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnUm9vbXNUYWJsZU5hbWUnLCB7XHJcbiAgICAgIHZhbHVlOiB0aGlzLnJvb21zVGFibGUudGFibGVOYW1lLFxyXG4gICAgICBkZXNjcmlwdGlvbjogJ0R5bmFtb0RCIFJvb21zIFRhYmxlIE5hbWUnLFxyXG4gICAgfSk7XHJcblxyXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ1ZvdGVzVGFibGVOYW1lJywge1xyXG4gICAgICB2YWx1ZTogdGhpcy52b3Rlc1RhYmxlLnRhYmxlTmFtZSxcclxuICAgICAgZGVzY3JpcHRpb246ICdEeW5hbW9EQiBWb3RlcyBUYWJsZSBOYW1lJyxcclxuICAgIH0pO1xyXG5cclxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdNYXRjaGVzVGFibGVOYW1lJywge1xyXG4gICAgICB2YWx1ZTogdGhpcy5tYXRjaGVzVGFibGUudGFibGVOYW1lLFxyXG4gICAgICBkZXNjcmlwdGlvbjogJ0R5bmFtb0RCIE1hdGNoZXMgVGFibGUgTmFtZScsXHJcbiAgICB9KTtcclxuXHJcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnVXNlcnNUYWJsZU5hbWUnLCB7XHJcbiAgICAgIHZhbHVlOiB0aGlzLnVzZXJzVGFibGUudGFibGVOYW1lLFxyXG4gICAgICBkZXNjcmlwdGlvbjogJ0R5bmFtb0RCIFVzZXJzIFRhYmxlIE5hbWUnLFxyXG4gICAgfSk7XHJcbiAgfVxyXG59Il19