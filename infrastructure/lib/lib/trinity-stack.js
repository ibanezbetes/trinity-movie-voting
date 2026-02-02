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
            // Remove email verification requirement
            autoVerify: {
            // email: true, // Commented out to disable email verification
            },
            standardAttributes: {
                email: {
                    required: true,
                    mutable: true,
                },
            },
            passwordPolicy: {
                minLength: 8,
                requireLowercase: false,
                requireUppercase: false,
                requireDigits: false,
                requireSymbols: false,
            },
            accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            // Add Lambda trigger to auto-confirm users
            lambdaTriggers: {
                preSignUp: new lambda.Function(this, 'PreSignUpTrigger', {
                    runtime: lambda.Runtime.NODEJS_20_X,
                    handler: 'index.handler',
                    code: lambda.Code.fromInline(`
            exports.handler = async (event) => {
              console.log('PreSignUp trigger event:', JSON.stringify(event, null, 2));
              
              // Auto-confirm all users and skip email verification
              event.response.autoConfirmUser = true;
              event.response.autoVerifyEmail = true;
              
              console.log('PreSignUp response:', JSON.stringify(event.response, null, 2));
              return event;
            };
          `),
                    timeout: cdk.Duration.seconds(10),
                }),
            },
        });
        // Create User Pool Client
        this.userPoolClient = new cognito.UserPoolClient(this, 'TrinityUserPoolClient', {
            userPool: this.userPool,
            userPoolClientName: 'trinity-mobile-client',
            generateSecret: false, // Required for mobile apps
            authFlows: {
                userSrp: true,
                userPassword: true,
                adminUserPassword: true, // Add this for admin operations
                custom: false,
            },
            preventUserExistenceErrors: true,
            // Add explicit token validity
            accessTokenValidity: cdk.Duration.hours(1),
            idTokenValidity: cdk.Duration.hours(1),
            refreshTokenValidity: cdk.Duration.days(30),
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
        };
        // TMDB Integration Lambda
        this.tmdbLambda = new lambda.Function(this, 'TMDBLambda', {
            ...commonLambdaProps,
            functionName: 'trinity-tmdb-handler',
            code: lambda.Code.fromAsset(path.join(__dirname, '../src/handlers/tmdb')),
            handler: 'index.handler',
            description: 'TMDB API integration with Latin script filtering',
        });
        // Room Handler Lambda
        this.roomLambda = new lambda.Function(this, 'RoomLambda', {
            ...commonLambdaProps,
            functionName: 'trinity-room-handler',
            code: lambda.Code.fromAsset(path.join(__dirname, '../src/handlers/room')),
            handler: 'index.handler',
            description: 'Room creation and joining logic',
        });
        // Vote Handler Lambda
        this.voteLambda = new lambda.Function(this, 'VoteLambda', {
            ...commonLambdaProps,
            functionName: 'trinity-vote-handler',
            code: lambda.Code.fromAsset(path.join(__dirname, '../src/handlers/vote')),
            handler: 'index.handler',
            description: 'Vote processing and match detection',
        });
        // Match Handler Lambda
        this.matchLambda = new lambda.Function(this, 'MatchLambda', {
            ...commonLambdaProps,
            functionName: 'trinity-match-handler',
            code: lambda.Code.fromAsset(path.join(__dirname, '../src/handlers/match')),
            handler: 'index.handler',
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
        // checkRoomMatch query
        matchDataSource.createResolver('CheckRoomMatchResolver', {
            typeName: 'Query',
            fieldName: 'checkRoomMatch',
            requestMappingTemplate: appsync.MappingTemplate.fromString(`
        {
          "version": "2017-02-28",
          "operation": "Invoke",
          "payload": {
            "operation": "checkRoomMatch",
            "roomId": "$context.arguments.roomId"
          }
        }
      `),
            responseMappingTemplate: appsync.MappingTemplate.fromString(`
        #if($context.error)
          $util.error($context.error.message, $context.error.type)
        #end
        #if($context.result.statusCode == 200)
          $util.toJson($context.result.body.match)
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidHJpbml0eS1zdGFjay5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uL3RyaW5pdHktc3RhY2sudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBQUEsaURBQW1DO0FBQ25DLG1FQUFxRDtBQUNyRCxpRUFBbUQ7QUFDbkQsaUVBQW1EO0FBQ25ELCtEQUFpRDtBQUlqRCwyQ0FBNkI7QUFFN0IsTUFBYSxZQUFhLFNBQVEsR0FBRyxDQUFDLEtBQUs7SUFlekMsWUFBWSxLQUFnQixFQUFFLEVBQVUsRUFBRSxLQUFzQjtRQUM5RCxLQUFLLENBQUMsS0FBSyxFQUFFLEVBQUUsRUFBRSxLQUFLLENBQUMsQ0FBQztRQUV4Qix5QkFBeUI7UUFDekIsSUFBSSxDQUFDLG9CQUFvQixFQUFFLENBQUM7UUFFNUIsMkJBQTJCO1FBQzNCLElBQUksQ0FBQyxxQkFBcUIsRUFBRSxDQUFDO1FBRTdCLDZCQUE2QjtRQUM3QixJQUFJLENBQUMsZ0JBQWdCLEVBQUUsQ0FBQztRQUV4QiwwQkFBMEI7UUFDMUIsSUFBSSxDQUFDLHFCQUFxQixFQUFFLENBQUM7UUFFN0IsMkJBQTJCO1FBQzNCLElBQUksQ0FBQyxlQUFlLEVBQUUsQ0FBQztRQUV2QiwwQkFBMEI7UUFDMUIsSUFBSSxDQUFDLGFBQWEsRUFBRSxDQUFDO0lBQ3ZCLENBQUM7SUFFTyxvQkFBb0I7UUFDMUIscUJBQXFCO1FBQ3JCLElBQUksQ0FBQyxVQUFVLEdBQUcsSUFBSSxRQUFRLENBQUMsS0FBSyxDQUFDLElBQUksRUFBRSxjQUFjLEVBQUU7WUFDekQsU0FBUyxFQUFFLGNBQWM7WUFDekIsWUFBWSxFQUFFO2dCQUNaLElBQUksRUFBRSxJQUFJO2dCQUNWLElBQUksRUFBRSxRQUFRLENBQUMsYUFBYSxDQUFDLE1BQU07YUFDcEM7WUFDRCxXQUFXLEVBQUUsUUFBUSxDQUFDLFdBQVcsQ0FBQyxlQUFlO1lBQ2pELGFBQWEsRUFBRSxHQUFHLENBQUMs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RSxJQUFJLENBQUMsR0FBRyxDQUFDLFVBQVU7WUFDMUIsV0FBVyxFQUFFLDhCQUE4QjtZQUMzQyxVQUFVLEVBQUUsd0JBQXdCO1NBQ3JDLENBQUMsQ0FBQztRQUVILElBQUksR0FBRyxDQUFDLFNBQVMsQ0FBQyxJQUFJLEVBQUUsV0FBVyxFQUFFO1lBQ25DLEtBQUssRUFBRSxJQUFJLENBQUMsTUFBTTtZQUNsQixXQUFXLEVBQUUsWUFBWTtZQUN6QixVQUFVLEVBQUUsa0JBQWtCO1NBQy9CLENBQUMsQ0FBQztRQUVILG1DQUFtQztRQUNuQyxJQUFJLEdBQUcsQ0FBQyxTQUFTLENBQUMsSUFBSSxFQUFFLGdCQUFnQixFQUFFO1lBQ3hDLEtBQUssRUFBRSxJQUFJLENBQUMsVUFBVSxDQUFDLFNBQVM7WUFDaEMsV0FBVyxFQUFFLDJCQUEyQjtTQUN6QyxDQUFDLENBQUM7UUFFSCxJQUFJLEdBQUcsQ0FBQyxTQUFTLENBQUMsSUFBSSxFQUFFLGdCQUFnQixFQUFFO1lBQ3hDLEtBQUssRUFBRSxJQUFJLENBQUMsVUFBVSxDQUFDLFNBQVM7WUFDaEMsV0FBVyxFQUFFLDJCQUEyQjtTQUN6QyxDQUFDLENBQUM7UUFFSCxJQUFJLEdBQUcsQ0FBQyxTQUFTLENBQUMsSUFBSSxFQUFFLGtCQUFrQixFQUFFO1lBQzFDLEtBQUssRUFBRSxJQUFJLENBQUMsWUFBWSxDQUFDLFNBQVM7WUFDbEMsV0FBVyxFQUFFLDZCQUE2QjtTQUMzQyxDQUFDLENBQUM7UUFFSCxJQUFJLEdBQUcsQ0FBQyxTQUFTLENBQUMsSUFBSSxFQUFFLGdCQUFnQixFQUFFO1lBQ3hDLEtBQUssRUFBRSxJQUFJLENBQUMsVUFBVSxDQUFDLFNBQVM7WUFDaEMsV0FBVyxFQUFFLDJCQUEyQjtTQUN6QyxDQUFDLENBQUM7SUFDTCxDQUFDO0NBQ0Y7QUExZkQsb0NBMGZDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0ICogYXMgY2RrIGZyb20gJ2F3cy1jZGstbGliJztcclxuaW1wb3J0ICogYXMgZHluYW1vZGIgZnJvbSAnYXdzLWNkay1saWIvYXdzLWR5bmFtb2RiJztcclxuaW1wb3J0ICogYXMgY29nbml0byBmcm9tICdhd3MtY2RrLWxpYi9hd3MtY29nbml0byc7XHJcbmltcG9ydCAqIGFzIGFwcHN5bmMgZnJvbSAnYXdzLWNkay1saWIvYXdzLWFwcHN5bmMnO1xyXG5pbXBvcnQgKiBhcyBsYW1iZGEgZnJvbSAnYXdzLWNkay1saWIvYXdzLWxhbWJkYSc7XHJcbmltcG9ydCAqIGFzIGxhbWJkYU5vZGVqcyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtbGFtYmRhLW5vZGVqcyc7XHJcbmltcG9ydCAqIGFzIGlhbSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtaWFtJztcclxuaW1wb3J0IHsgQ29uc3RydWN0IH0gZnJvbSAnY29uc3RydWN0cyc7XHJcbmltcG9ydCAqIGFzIHBhdGggZnJvbSAncGF0aCc7XHJcblxyXG5leHBvcnQgY2xhc3MgVHJpbml0eVN0YWNrIGV4dGVuZHMgY2RrLlN0YWNrIHtcclxuICBwdWJsaWMgdXNlclBvb2w6IGNvZ25pdG8uVXNlclBvb2w7XHJcbiAgcHVibGljIHVzZXJQb29sQ2xpZW50OiBjb2duaXRvLlVzZXJQb29sQ2xpZW50O1xyXG4gIHB1YmxpYyBhcGk6IGFwcHN5bmMuR3JhcGhxbEFwaTtcclxuICBwdWJsaWMgcm9vbXNUYWJsZTogZHluYW1vZGIuVGFibGU7XHJcbiAgcHVibGljIHZvdGVzVGFibGU6IGR5bmFtb2RiLlRhYmxlO1xyXG4gIHB1YmxpYyBtYXRjaGVzVGFibGU6IGR5bmFtb2RiLlRhYmxlO1xyXG4gIHB1YmxpYyB1c2Vyc1RhYmxlOiBkeW5hbW9kYi5UYWJsZTtcclxuICBcclxuICAvLyBMYW1iZGEgRnVuY3Rpb25zXHJcbiAgcHVibGljIHRtZGJMYW1iZGE6IGxhbWJkYS5GdW5jdGlvbjtcclxuICBwdWJsaWMgcm9vbUxhbWJkYTogbGFtYmRhLkZ1bmN0aW9uO1xyXG4gIHB1YmxpYyB2b3RlTGFtYmRhOiBsYW1iZGEuRnVuY3Rpb247XHJcbiAgcHVibGljIG1hdGNoTGFtYmRhOiBsYW1iZGEuRnVuY3Rpb247XHJcblxyXG4gIGNvbnN0cnVjdG9yKHNjb3BlOiBDb25zdHJ1Y3QsIGlkOiBzdHJpbmcsIHByb3BzPzogY2RrLlN0YWNrUHJvcHMpIHtcclxuICAgIHN1cGVyKHNjb3BlLCBpZCwgcHJvcHMpO1xyXG5cclxuICAgIC8vIENyZWF0ZSBEeW5hbW9EQiBUYWJsZXNcclxuICAgIHRoaXMuY3JlYXRlRHluYW1vREJUYWJsZXMoKTtcclxuICAgIFxyXG4gICAgLy8gQ3JlYXRlIENvZ25pdG8gVXNlciBQb29sXHJcbiAgICB0aGlzLmNyZWF0ZUNvZ25pdG9Vc2VyUG9vbCgpO1xyXG4gICAgXHJcbiAgICAvLyBDcmVhdGUgQXBwU3luYyBHcmFwaFFMIEFQSVxyXG4gICAgdGhpcy5jcmVhdGVBcHBTeW5jQVBJKCk7XHJcbiAgICBcclxuICAgIC8vIENyZWF0ZSBMYW1iZGEgRnVuY3Rpb25zXHJcbiAgICB0aGlzLmNyZWF0ZUxhbWJkYUZ1bmN0aW9ucygpO1xyXG4gICAgXHJcbiAgICAvLyBDcmVhdGUgQXBwU3luYyBSZXNvbHZlcnNcclxuICAgIHRoaXMuY3JlYXRlUmVzb2x2ZXJzKCk7XHJcblxyXG4gICAgLy8gT3V0cHV0IGltcG9ydGFudCB2YWx1ZXNcclxuICAgIHRoaXMuY3JlYXRlT3V0cHV0cygpO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBjcmVhdGVEeW5hbW9EQlRhYmxlcygpIHtcclxuICAgIC8vIFRyaW5pdHlSb29tcyBUYWJsZVxyXG4gICAgdGhpcy5yb29tc1RhYmxlID0gbmV3IGR5bmFtb2RiLlRhYmxlKHRoaXMsICdUcmluaXR5Um9vbXMnLCB7XHJcbiAgICAgIHRhYmxlTmFtZTogJ1RyaW5pdHlSb29tcycsXHJcbiAgICAgIHBhcnRpdGlvbktleToge1xyXG4gICAgICAgIG5hbWU6ICdpZCcsXHJcbiAgICAgICAgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcsXHJcbiAgICAgIH0sXHJcbiAgICAgIGJpbGxpbmdNb2RlOiBkeW5hbW9kYi5CaWxsaW5nTW9kZS5QQVlfUEVSX1JFUVVFU1QsXHJcbiAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LkRFU1RST1ksIC8vIEZvciBkZXZlbG9wbWVudFxyXG4gICAgICBwb2ludEluVGltZVJlY292ZXJ5OiB0cnVlLFxyXG4gICAgICB0aW1lVG9MaXZlQXR0cmlidXRlOiAndHRsJyxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIEdsb2JhbCBTZWNvbmRhcnkgSW5kZXggZm9yIHJvb20gY29kZSBsb29rdXBcclxuICAgIHRoaXMucm9vbXNUYWJsZS5hZGRHbG9iYWxTZWNvbmRhcnlJbmRleCh7XHJcbiAgICAgIGluZGV4TmFtZTogJ2NvZGUtaW5kZXgnLFxyXG4gICAgICBwYXJ0aXRpb25LZXk6IHtcclxuICAgICAgICBuYW1lOiAnY29kZScsXHJcbiAgICAgICAgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcsXHJcbiAgICAgIH0sXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBUcmluaXR5Vm90ZXMgVGFibGVcclxuICAgIHRoaXMudm90ZXNUYWJsZSA9IG5ldyBkeW5hbW9kYi5UYWJsZSh0aGlzLCAnVHJpbml0eVZvdGVzJywge1xyXG4gICAgICB0YWJsZU5hbWU6ICdUcmluaXR5Vm90ZXMnLFxyXG4gICAgICBwYXJ0aXRpb25LZXk6IHtcclxuICAgICAgICBuYW1lOiAncm9vbUlkJyxcclxuICAgICAgICB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyxcclxuICAgICAgfSxcclxuICAgICAgc29ydEtleToge1xyXG4gICAgICAgIG5hbWU6ICd1c2VyTW92aWVJZCcsXHJcbiAgICAgICAgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcsXHJcbiAgICAgIH0sXHJcbiAgICAgIGJpbGxpbmdNb2RlOiBkeW5hbW9kYi5CaWxsaW5nTW9kZS5QQVlfUEVSX1JFUVVFU1QsXHJcbiAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LkRFU1RST1ksXHJcbiAgICAgIHBvaW50SW5UaW1lUmVjb3Zlcnk6IHRydWUsXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBUcmluaXR5TWF0Y2hlcyBUYWJsZVxyXG4gICAgdGhpcy5tYXRjaGVzVGFibGUgPSBuZXcgZHluYW1vZGIuVGFibGUodGhpcywgJ1RyaW5pdHlNYXRjaGVzJywge1xyXG4gICAgICB0YWJsZU5hbWU6ICdUcmluaXR5TWF0Y2hlcycsXHJcbiAgICAgIHBhcnRpdGlvbktleToge1xyXG4gICAgICAgIG5hbWU6ICdyb29tSWQnLFxyXG4gICAgICAgIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HLFxyXG4gICAgICB9LFxyXG4gICAgICBzb3J0S2V5OiB7XHJcbiAgICAgICAgbmFtZTogJ21vdmllSWQnLFxyXG4gICAgICAgIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuTlVNQkVSLFxyXG4gICAgICB9LFxyXG4gICAgICBiaWxsaW5nTW9kZTogZHluYW1vZGIuQmlsbGluZ01vZGUuUEFZX1BFUl9SRVFVRVNULFxyXG4gICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLFxyXG4gICAgICBwb2ludEluVGltZVJlY292ZXJ5OiB0cnVlLFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gTG9jYWwgU2Vjb25kYXJ5IEluZGV4IGZvciB0aW1lc3RhbXAtYmFzZWQgcXVlcmllc1xyXG4gICAgdGhpcy5tYXRjaGVzVGFibGUuYWRkTG9jYWxTZWNvbmRhcnlJbmRleCh7XHJcbiAgICAgIGluZGV4TmFtZTogJ3RpbWVzdGFtcC1pbmRleCcsXHJcbiAgICAgIHNvcnRLZXk6IHtcclxuICAgICAgICBuYW1lOiAndGltZXN0YW1wJyxcclxuICAgICAgICB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyxcclxuICAgICAgfSxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIFRyaW5pdHlVc2VycyBUYWJsZVxyXG4gICAgdGhpcy51c2Vyc1RhYmxlID0gbmV3IGR5bmFtb2RiLlRhYmxlKHRoaXMsICdUcmluaXR5VXNlcnMnLCB7XHJcbiAgICAgIHRhYmxlTmFtZTogJ1RyaW5pdHlVc2VycycsXHJcbiAgICAgIHBhcnRpdGlvbktleToge1xyXG4gICAgICAgIG5hbWU6ICdpZCcsXHJcbiAgICAgICAgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcsXHJcbiAgICAgIH0sXHJcbiAgICAgIGJpbGxpbmdNb2RlOiBkeW5hbW9kYi5CaWxsaW5nTW9kZS5QQVlfUEVSX1JFUVVFU1QsXHJcbiAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LkRFU1RST1ksXHJcbiAgICAgIHBvaW50SW5UaW1lUmVjb3Zlcnk6IHRydWUsXHJcbiAgICB9KTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgY3JlYXRlQ29nbml0b1VzZXJQb29sKCkge1xyXG4gICAgLy8gQ3JlYXRlIFVzZXIgUG9vbFxyXG4gICAgdGhpcy51c2VyUG9vbCA9IG5ldyBjb2duaXRvLlVzZXJQb29sKHRoaXMsICdUcmluaXR5VXNlclBvb2wnLCB7XHJcbiAgICAgIHVzZXJQb29sTmFtZTogJ3RyaW5pdHktdXNlci1wb29sJyxcclxuICAgICAgc2VsZlNpZ25VcEVuYWJsZWQ6IHRydWUsXHJcbiAgICAgIHNpZ25JbkFsaWFzZXM6IHtcclxuICAgICAgICBlbWFpbDogdHJ1ZSxcclxuICAgICAgfSxcclxuICAgICAgLy8gUmVtb3ZlIGVtYWlsIHZlcmlmaWNhdGlvbiByZXF1aXJlbWVudFxyXG4gICAgICBhdXRvVmVyaWZ5OiB7XHJcbiAgICAgICAgLy8gZW1haWw6IHRydWUsIC8vIENvbW1lbnRlZCBvdXQgdG8gZGlzYWJsZSBlbWFpbCB2ZXJpZmljYXRpb25cclxuICAgICAgfSxcclxuICAgICAgc3RhbmRhcmRBdHRyaWJ1dGVzOiB7XHJcbiAgICAgICAgZW1haWw6IHtcclxuICAgICAgICAgIHJlcXVpcmVkOiB0cnVlLFxyXG4gICAgICAgICAgbXV0YWJsZTogdHJ1ZSxcclxuICAgICAgICB9LFxyXG4gICAgICB9LFxyXG4gICAgICBwYXNzd29yZFBvbGljeToge1xyXG4gICAgICAgIG1pbkxlbmd0aDogOCxcclxuICAgICAgICByZXF1aXJlTG93ZXJjYXNlOiBmYWxzZSxcclxuICAgICAgICByZXF1aXJlVXBwZXJjYXNlOiBmYWxzZSxcclxuICAgICAgICByZXF1aXJlRGlnaXRzOiBmYWxzZSxcclxuICAgICAgICByZXF1aXJlU3ltYm9sczogZmFsc2UsXHJcbiAgICAgIH0sXHJcbiAgICAgIGFjY291bnRSZWNvdmVyeTogY29nbml0by5BY2NvdW50UmVjb3ZlcnkuRU1BSUxfT05MWSxcclxuICAgICAgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuREVTVFJPWSxcclxuICAgICAgLy8gQWRkIExhbWJkYSB0cmlnZ2VyIHRvIGF1dG8tY29uZmlybSB1c2Vyc1xyXG4gICAgICBsYW1iZGFUcmlnZ2Vyczoge1xyXG4gICAgICAgIHByZVNpZ25VcDogbmV3IGxhbWJkYS5GdW5jdGlvbih0aGlzLCAnUHJlU2lnblVwVHJpZ2dlcicsIHtcclxuICAgICAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLk5PREVKU18yMF9YLFxyXG4gICAgICAgICAgaGFuZGxlcjogJ2luZGV4LmhhbmRsZXInLFxyXG4gICAgICAgICAgY29kZTogbGFtYmRhLkNvZGUuZnJvbUlubGluZShgXHJcbiAgICAgICAgICAgIGV4cG9ydHMuaGFuZGxlciA9IGFzeW5jIChldmVudCkgPT4ge1xyXG4gICAgICAgICAgICAgIGNvbnNvbGUubG9nKCdQcmVTaWduVXAgdHJpZ2dlciBldmVudDonLCBKU09OLnN0cmluZ2lmeShldmVudCwgbnVsbCwgMikpO1xyXG4gICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgIC8vIEF1dG8tY29uZmlybSBhbGwgdXNlcnMgYW5kIHNraXAgZW1haWwgdmVyaWZpY2F0aW9uXHJcbiAgICAgICAgICAgICAgZXZlbnQucmVzcG9uc2UuYXV0b0NvbmZpcm1Vc2VyID0gdHJ1ZTtcclxuICAgICAgICAgICAgICBldmVudC5yZXNwb25zZS5hdXRvVmVyaWZ5RW1haWwgPSB0cnVlO1xyXG4gICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgIGNvbnNvbGUubG9nKCdQcmVTaWduVXAgcmVzcG9uc2U6JywgSlNPTi5zdHJpbmdpZnkoZXZlbnQucmVzcG9uc2UsIG51bGwsIDIpKTtcclxuICAgICAgICAgICAgICByZXR1cm4gZXZlbnQ7XHJcbiAgICAgICAgICAgIH07XHJcbiAgICAgICAgICBgKSxcclxuICAgICAgICAgIHRpbWVvdXQ6IGNkay5EdXJhdGlvbi5zZWNvbmRzKDEwKSxcclxuICAgICAgICB9KSxcclxuICAgICAgfSxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIENyZWF0ZSBVc2VyIFBvb2wgQ2xpZW50XHJcbiAgICB0aGlzLnVzZXJQb29sQ2xpZW50ID0gbmV3IGNvZ25pdG8uVXNlclBvb2xDbGllbnQodGhpcywgJ1RyaW5pdHlVc2VyUG9vbENsaWVudCcsIHtcclxuICAgICAgdXNlclBvb2w6IHRoaXMudXNlclBvb2wsXHJcbiAgICAgIHVzZXJQb29sQ2xpZW50TmFtZTogJ3RyaW5pdHktbW9iaWxlLWNsaWVudCcsXHJcbiAgICAgIGdlbmVyYXRlU2VjcmV0OiBmYWxzZSwgLy8gUmVxdWlyZWQgZm9yIG1vYmlsZSBhcHBzXHJcbiAgICAgIGF1dGhGbG93czoge1xyXG4gICAgICAgIHVzZXJTcnA6IHRydWUsXHJcbiAgICAgICAgdXNlclBhc3N3b3JkOiB0cnVlLFxyXG4gICAgICAgIGFkbWluVXNlclBhc3N3b3JkOiB0cnVlLCAvLyBBZGQgdGhpcyBmb3IgYWRtaW4gb3BlcmF0aW9uc1xyXG4gICAgICAgIGN1c3RvbTogZmFsc2UsXHJcbiAgICAgIH0sXHJcbiAgICAgIHByZXZlbnRVc2VyRXhpc3RlbmNlRXJyb3JzOiB0cnVlLFxyXG4gICAgICAvLyBBZGQgZXhwbGljaXQgdG9rZW4gdmFsaWRpdHlcclxuICAgICAgYWNjZXNzVG9rZW5WYWxpZGl0eTogY2RrLkR1cmF0aW9uLmhvdXJzKDEpLFxyXG4gICAgICBpZFRva2VuVmFsaWRpdHk6IGNkay5EdXJhdGlvbi5ob3VycygxKSxcclxuICAgICAgcmVmcmVzaFRva2VuVmFsaWRpdHk6IGNkay5EdXJhdGlvbi5kYXlzKDMwKSxcclxuICAgIH0pO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBjcmVhdGVBcHBTeW5jQVBJKCkge1xyXG4gICAgLy8gQ3JlYXRlIEFwcFN5bmMgR3JhcGhRTCBBUElcclxuICAgIHRoaXMuYXBpID0gbmV3IGFwcHN5bmMuR3JhcGhxbEFwaSh0aGlzLCAnVHJpbml0eUFQSScsIHtcclxuICAgICAgbmFtZTogJ3RyaW5pdHktYXBpJyxcclxuICAgICAgZGVmaW5pdGlvbjogYXBwc3luYy5EZWZpbml0aW9uLmZyb21GaWxlKHBhdGguam9pbihfX2Rpcm5hbWUsICcuLi9zY2hlbWEuZ3JhcGhxbCcpKSxcclxuICAgICAgYXV0aG9yaXphdGlvbkNvbmZpZzoge1xyXG4gICAgICAgIGRlZmF1bHRBdXRob3JpemF0aW9uOiB7XHJcbiAgICAgICAgICBhdXRob3JpemF0aW9uVHlwZTogYXBwc3luYy5BdXRob3JpemF0aW9uVHlwZS5VU0VSX1BPT0wsXHJcbiAgICAgICAgICB1c2VyUG9vbENvbmZpZzoge1xyXG4gICAgICAgICAgICB1c2VyUG9vbDogdGhpcy51c2VyUG9vbCxcclxuICAgICAgICAgIH0sXHJcbiAgICAgICAgfSxcclxuICAgICAgfSxcclxuICAgICAgbG9nQ29uZmlnOiB7XHJcbiAgICAgICAgZmllbGRMb2dMZXZlbDogYXBwc3luYy5GaWVsZExvZ0xldmVsLkFMTCxcclxuICAgICAgfSxcclxuICAgICAgeHJheUVuYWJsZWQ6IHRydWUsXHJcbiAgICB9KTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgY3JlYXRlTGFtYmRhRnVuY3Rpb25zKCkge1xyXG4gICAgLy8gQ29tbW9uIExhbWJkYSBjb25maWd1cmF0aW9uXHJcbiAgICBjb25zdCBjb21tb25MYW1iZGFQcm9wcyA9IHtcclxuICAgICAgcnVudGltZTogbGFtYmRhLlJ1bnRpbWUuTk9ERUpTXzIwX1gsXHJcbiAgICAgIHRpbWVvdXQ6IGNkay5EdXJhdGlvbi5zZWNvbmRzKDMwKSxcclxuICAgICAgbWVtb3J5U2l6ZTogNTEyLFxyXG4gICAgICBlbnZpcm9ubWVudDoge1xyXG4gICAgICAgIFRNREJfQVBJX0tFWTogcHJvY2Vzcy5lbnYuVE1EQl9BUElfS0VZIHx8ICcnLFxyXG4gICAgICAgIFRNREJfUkVBRF9UT0tFTjogcHJvY2Vzcy5lbnYuVE1EQl9SRUFEX1RPS0VOIHx8ICcnLFxyXG4gICAgICAgIFRNREJfQkFTRV9VUkw6IHByb2Nlc3MuZW52LlRNREJfQkFTRV9VUkwgfHwgJ2h0dHBzOi8vYXBpLnRoZW1vdmllZGIub3JnLzMnLFxyXG4gICAgICAgIFJPT01TX1RBQkxFOiB0aGlzLnJvb21zVGFibGUudGFibGVOYW1lLFxyXG4gICAgICAgIFZPVEVTX1RBQkxFOiB0aGlzLnZvdGVzVGFibGUudGFibGVOYW1lLFxyXG4gICAgICAgIE1BVENIRVNfVEFCTEU6IHRoaXMubWF0Y2hlc1RhYmxlLnRhYmxlTmFtZSxcclxuICAgICAgICBVU0VSU19UQUJMRTogdGhpcy51c2Vyc1RhYmxlLnRhYmxlTmFtZSxcclxuICAgICAgfSxcclxuICAgIH07XHJcblxyXG4gICAgLy8gVE1EQiBJbnRlZ3JhdGlvbiBMYW1iZGFcclxuICAgIHRoaXMudG1kYkxhbWJkYSA9IG5ldyBsYW1iZGEuRnVuY3Rpb24odGhpcywgJ1RNREJMYW1iZGEnLCB7XHJcbiAgICAgIC4uLmNvbW1vbkxhbWJkYVByb3BzLFxyXG4gICAgICBmdW5jdGlvbk5hbWU6ICd0cmluaXR5LXRtZGItaGFuZGxlcicsXHJcbiAgICAgIGNvZGU6IGxhbWJkYS5Db2RlLmZyb21Bc3NldChwYXRoLmpvaW4oX19kaXJuYW1lLCAnLi4vc3JjL2hhbmRsZXJzL3RtZGInKSksXHJcbiAgICAgIGhhbmRsZXI6ICdpbmRleC5oYW5kbGVyJyxcclxuICAgICAgZGVzY3JpcHRpb246ICdUTURCIEFQSSBpbnRlZ3JhdGlvbiB3aXRoIExhdGluIHNjcmlwdCBmaWx0ZXJpbmcnLFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gUm9vbSBIYW5kbGVyIExhbWJkYVxyXG4gICAgdGhpcy5yb29tTGFtYmRhID0gbmV3IGxhbWJkYS5GdW5jdGlvbih0aGlzLCAnUm9vbUxhbWJkYScsIHtcclxuICAgICAgLi4uY29tbW9uTGFtYmRhUHJvcHMsXHJcbiAgICAgIGZ1bmN0aW9uTmFtZTogJ3RyaW5pdHktcm9vbS1oYW5kbGVyJyxcclxuICAgICAgY29kZTogbGFtYmRhLkNvZGUuZnJvbUFzc2V0KHBhdGguam9pbihfX2Rpcm5hbWUsICcuLi9zcmMvaGFuZGxlcnMvcm9vbScpKSxcclxuICAgICAgaGFuZGxlcjogJ2luZGV4LmhhbmRsZXInLFxyXG4gICAgICBkZXNjcmlwdGlvbjogJ1Jvb20gY3JlYXRpb24gYW5kIGpvaW5pbmcgbG9naWMnLFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gVm90ZSBIYW5kbGVyIExhbWJkYVxyXG4gICAgdGhpcy52b3RlTGFtYmRhID0gbmV3IGxhbWJkYS5GdW5jdGlvbih0aGlzLCAnVm90ZUxhbWJkYScsIHtcclxuICAgICAgLi4uY29tbW9uTGFtYmRhUHJvcHMsXHJcbiAgICAgIGZ1bmN0aW9uTmFtZTogJ3RyaW5pdHktdm90ZS1oYW5kbGVyJyxcclxuICAgICAgY29kZTogbGFtYmRhLkNvZGUuZnJvbUFzc2V0KHBhdGguam9pbihfX2Rpcm5hbWUsICcuLi9zcmMvaGFuZGxlcnMvdm90ZScpKSxcclxuICAgICAgaGFuZGxlcjogJ2luZGV4LmhhbmRsZXInLFxyXG4gICAgICBkZXNjcmlwdGlvbjogJ1ZvdGUgcHJvY2Vzc2luZyBhbmQgbWF0Y2ggZGV0ZWN0aW9uJyxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIE1hdGNoIEhhbmRsZXIgTGFtYmRhXHJcbiAgICB0aGlzLm1hdGNoTGFtYmRhID0gbmV3IGxhbWJkYS5GdW5jdGlvbih0aGlzLCAnTWF0Y2hMYW1iZGEnLCB7XHJcbiAgICAgIC4uLmNvbW1vbkxhbWJkYVByb3BzLFxyXG4gICAgICBmdW5jdGlvbk5hbWU6ICd0cmluaXR5LW1hdGNoLWhhbmRsZXInLFxyXG4gICAgICBjb2RlOiBsYW1iZGEuQ29kZS5mcm9tQXNzZXQocGF0aC5qb2luKF9fZGlybmFtZSwgJy4uL3NyYy9oYW5kbGVycy9tYXRjaCcpKSxcclxuICAgICAgaGFuZGxlcjogJ2luZGV4LmhhbmRsZXInLFxyXG4gICAgICBkZXNjcmlwdGlvbjogJ01hdGNoIGNyZWF0aW9uIGFuZCBoaXN0b3J5IG1hbmFnZW1lbnQnLFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gVXBkYXRlIExhbWJkYSBlbnZpcm9ubWVudCB2YXJpYWJsZXMgd2l0aCBjcm9zcy1yZWZlcmVuY2VzXHJcbiAgICB0aGlzLnJvb21MYW1iZGEuYWRkRW52aXJvbm1lbnQoJ1RNREJfTEFNQkRBX0FSTicsIHRoaXMudG1kYkxhbWJkYS5mdW5jdGlvbkFybik7XHJcbiAgICB0aGlzLnZvdGVMYW1iZGEuYWRkRW52aXJvbm1lbnQoJ01BVENIX0xBTUJEQV9BUk4nLCB0aGlzLm1hdGNoTGFtYmRhLmZ1bmN0aW9uQXJuKTtcclxuXHJcbiAgICAvLyBHcmFudCBEeW5hbW9EQiBwZXJtaXNzaW9uc1xyXG4gICAgdGhpcy5ncmFudER5bmFtb0RCUGVybWlzc2lvbnMoKTtcclxuXHJcbiAgICAvLyBHcmFudCBMYW1iZGEgaW52b2tlIHBlcm1pc3Npb25zXHJcbiAgICB0aGlzLmdyYW50TGFtYmRhUGVybWlzc2lvbnMoKTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgZ3JhbnREeW5hbW9EQlBlcm1pc3Npb25zKCkge1xyXG4gICAgLy8gR3JhbnQgcmVhZC93cml0ZSBwZXJtaXNzaW9ucyB0byBhbGwgdGFibGVzIGZvciBhbGwgbGFtYmRhc1xyXG4gICAgY29uc3QgbGFtYmRhcyA9IFt0aGlzLnRtZGJMYW1iZGEsIHRoaXMucm9vbUxhbWJkYSwgdGhpcy52b3RlTGFtYmRhLCB0aGlzLm1hdGNoTGFtYmRhXTtcclxuICAgIGNvbnN0IHRhYmxlcyA9IFt0aGlzLnJvb21zVGFibGUsIHRoaXMudm90ZXNUYWJsZSwgdGhpcy5tYXRjaGVzVGFibGUsIHRoaXMudXNlcnNUYWJsZV07XHJcblxyXG4gICAgbGFtYmRhcy5mb3JFYWNoKGxhbWJkYUZuID0+IHtcclxuICAgICAgdGFibGVzLmZvckVhY2godGFibGUgPT4ge1xyXG4gICAgICAgIHRhYmxlLmdyYW50UmVhZFdyaXRlRGF0YShsYW1iZGFGbik7XHJcbiAgICAgIH0pO1xyXG4gICAgfSk7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGdyYW50TGFtYmRhUGVybWlzc2lvbnMoKSB7XHJcbiAgICAvLyBBbGxvdyBSb29tIExhbWJkYSB0byBpbnZva2UgVE1EQiBMYW1iZGFcclxuICAgIHRoaXMudG1kYkxhbWJkYS5ncmFudEludm9rZSh0aGlzLnJvb21MYW1iZGEpO1xyXG4gICAgXHJcbiAgICAvLyBBbGxvdyBWb3RlIExhbWJkYSB0byBpbnZva2UgTWF0Y2ggTGFtYmRhXHJcbiAgICB0aGlzLm1hdGNoTGFtYmRhLmdyYW50SW52b2tlKHRoaXMudm90ZUxhbWJkYSk7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGNyZWF0ZVJlc29sdmVycygpIHtcclxuICAgIC8vIENyZWF0ZSBMYW1iZGEgZGF0YSBzb3VyY2VzXHJcbiAgICBjb25zdCByb29tRGF0YVNvdXJjZSA9IHRoaXMuYXBpLmFkZExhbWJkYURhdGFTb3VyY2UoJ1Jvb21EYXRhU291cmNlJywgdGhpcy5yb29tTGFtYmRhKTtcclxuICAgIGNvbnN0IHZvdGVEYXRhU291cmNlID0gdGhpcy5hcGkuYWRkTGFtYmRhRGF0YVNvdXJjZSgnVm90ZURhdGFTb3VyY2UnLCB0aGlzLnZvdGVMYW1iZGEpO1xyXG4gICAgY29uc3QgbWF0Y2hEYXRhU291cmNlID0gdGhpcy5hcGkuYWRkTGFtYmRhRGF0YVNvdXJjZSgnTWF0Y2hEYXRhU291cmNlJywgdGhpcy5tYXRjaExhbWJkYSk7XHJcblxyXG4gICAgLy8gTXV0YXRpb24gUmVzb2x2ZXJzXHJcbiAgICBcclxuICAgIC8vIGNyZWF0ZVJvb20gbXV0YXRpb25cclxuICAgIHJvb21EYXRhU291cmNlLmNyZWF0ZVJlc29sdmVyKCdDcmVhdGVSb29tUmVzb2x2ZXInLCB7XHJcbiAgICAgIHR5cGVOYW1lOiAnTXV0YXRpb24nLFxyXG4gICAgICBmaWVsZE5hbWU6ICdjcmVhdGVSb29tJyxcclxuICAgICAgcmVxdWVzdE1hcHBpbmdUZW1wbGF0ZTogYXBwc3luYy5NYXBwaW5nVGVtcGxhdGUuZnJvbVN0cmluZyhgXHJcbiAgICAgICAge1xyXG4gICAgICAgICAgXCJ2ZXJzaW9uXCI6IFwiMjAxNy0wMi0yOFwiLFxyXG4gICAgICAgICAgXCJvcGVyYXRpb25cIjogXCJJbnZva2VcIixcclxuICAgICAgICAgIFwicGF5bG9hZFwiOiB7XHJcbiAgICAgICAgICAgIFwib3BlcmF0aW9uXCI6IFwiY3JlYXRlUm9vbVwiLFxyXG4gICAgICAgICAgICBcInVzZXJJZFwiOiBcIiRjb250ZXh0LmlkZW50aXR5LnN1YlwiLFxyXG4gICAgICAgICAgICBcImlucHV0XCI6ICR1dGlsLnRvSnNvbigkY29udGV4dC5hcmd1bWVudHMuaW5wdXQpXHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgICBgKSxcclxuICAgICAgcmVzcG9uc2VNYXBwaW5nVGVtcGxhdGU6IGFwcHN5bmMuTWFwcGluZ1RlbXBsYXRlLmZyb21TdHJpbmcoYFxyXG4gICAgICAgICNpZigkY29udGV4dC5lcnJvcilcclxuICAgICAgICAgICR1dGlsLmVycm9yKCRjb250ZXh0LmVycm9yLm1lc3NhZ2UsICRjb250ZXh0LmVycm9yLnR5cGUpXHJcbiAgICAgICAgI2VuZFxyXG4gICAgICAgICNpZigkY29udGV4dC5yZXN1bHQuc3RhdHVzQ29kZSA9PSAyMDApXHJcbiAgICAgICAgICAkdXRpbC50b0pzb24oJGNvbnRleHQucmVzdWx0LmJvZHkpXHJcbiAgICAgICAgI2Vsc2VcclxuICAgICAgICAgICR1dGlsLmVycm9yKCRjb250ZXh0LnJlc3VsdC5ib2R5LmVycm9yLCBcIkJhZFJlcXVlc3RcIilcclxuICAgICAgICAjZW5kXHJcbiAgICAgIGApLFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gam9pblJvb20gbXV0YXRpb25cclxuICAgIHJvb21EYXRhU291cmNlLmNyZWF0ZVJlc29sdmVyKCdKb2luUm9vbVJlc29sdmVyJywge1xyXG4gICAgICB0eXBlTmFtZTogJ011dGF0aW9uJyxcclxuICAgICAgZmllbGROYW1lOiAnam9pblJvb20nLFxyXG4gICAgICByZXF1ZXN0TWFwcGluZ1RlbXBsYXRlOiBhcHBzeW5jLk1hcHBpbmdUZW1wbGF0ZS5mcm9tU3RyaW5nKGBcclxuICAgICAgICB7XHJcbiAgICAgICAgICBcInZlcnNpb25cIjogXCIyMDE3LTAyLTI4XCIsXHJcbiAgICAgICAgICBcIm9wZXJhdGlvblwiOiBcIkludm9rZVwiLFxyXG4gICAgICAgICAgXCJwYXlsb2FkXCI6IHtcclxuICAgICAgICAgICAgXCJvcGVyYXRpb25cIjogXCJqb2luUm9vbVwiLFxyXG4gICAgICAgICAgICBcInVzZXJJZFwiOiBcIiRjb250ZXh0LmlkZW50aXR5LnN1YlwiLFxyXG4gICAgICAgICAgICBcImNvZGVcIjogXCIkY29udGV4dC5hcmd1bWVudHMuY29kZVwiXHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgICBgKSxcclxuICAgICAgcmVzcG9uc2VNYXBwaW5nVGVtcGxhdGU6IGFwcHN5bmMuTWFwcGluZ1RlbXBsYXRlLmZyb21TdHJpbmcoYFxyXG4gICAgICAgICNpZigkY29udGV4dC5lcnJvcilcclxuICAgICAgICAgICR1dGlsLmVycm9yKCRjb250ZXh0LmVycm9yLm1lc3NhZ2UsICRjb250ZXh0LmVycm9yLnR5cGUpXHJcbiAgICAgICAgI2VuZFxyXG4gICAgICAgICNpZigkY29udGV4dC5yZXN1bHQuc3RhdHVzQ29kZSA9PSAyMDApXHJcbiAgICAgICAgICAkdXRpbC50b0pzb24oJGNvbnRleHQucmVzdWx0LmJvZHkpXHJcbiAgICAgICAgI2Vsc2VcclxuICAgICAgICAgICR1dGlsLmVycm9yKCRjb250ZXh0LnJlc3VsdC5ib2R5LmVycm9yLCBcIkJhZFJlcXVlc3RcIilcclxuICAgICAgICAjZW5kXHJcbiAgICAgIGApLFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gdm90ZSBtdXRhdGlvblxyXG4gICAgdm90ZURhdGFTb3VyY2UuY3JlYXRlUmVzb2x2ZXIoJ1ZvdGVSZXNvbHZlcicsIHtcclxuICAgICAgdHlwZU5hbWU6ICdNdXRhdGlvbicsXHJcbiAgICAgIGZpZWxkTmFtZTogJ3ZvdGUnLFxyXG4gICAgICByZXF1ZXN0TWFwcGluZ1RlbXBsYXRlOiBhcHBzeW5jLk1hcHBpbmdUZW1wbGF0ZS5mcm9tU3RyaW5nKGBcclxuICAgICAgICB7XHJcbiAgICAgICAgICBcInZlcnNpb25cIjogXCIyMDE3LTAyLTI4XCIsXHJcbiAgICAgICAgICBcIm9wZXJhdGlvblwiOiBcIkludm9rZVwiLFxyXG4gICAgICAgICAgXCJwYXlsb2FkXCI6IHtcclxuICAgICAgICAgICAgXCJvcGVyYXRpb25cIjogXCJ2b3RlXCIsXHJcbiAgICAgICAgICAgIFwidXNlcklkXCI6IFwiJGNvbnRleHQuaWRlbnRpdHkuc3ViXCIsXHJcbiAgICAgICAgICAgIFwiaW5wdXRcIjogJHV0aWwudG9Kc29uKCRjb250ZXh0LmFyZ3VtZW50cy5pbnB1dClcclxuICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICAgIGApLFxyXG4gICAgICByZXNwb25zZU1hcHBpbmdUZW1wbGF0ZTogYXBwc3luYy5NYXBwaW5nVGVtcGxhdGUuZnJvbVN0cmluZyhgXHJcbiAgICAgICAgI2lmKCRjb250ZXh0LmVycm9yKVxyXG4gICAgICAgICAgJHV0aWwuZXJyb3IoJGNvbnRleHQuZXJyb3IubWVzc2FnZSwgJGNvbnRleHQuZXJyb3IudHlwZSlcclxuICAgICAgICAjZW5kXHJcbiAgICAgICAgI2lmKCRjb250ZXh0LnJlc3VsdC5zdGF0dXNDb2RlID09IDIwMClcclxuICAgICAgICAgICR1dGlsLnRvSnNvbigkY29udGV4dC5yZXN1bHQuYm9keSlcclxuICAgICAgICAjZWxzZVxyXG4gICAgICAgICAgJHV0aWwuZXJyb3IoJGNvbnRleHQucmVzdWx0LmJvZHkuZXJyb3IsIFwiQmFkUmVxdWVzdFwiKVxyXG4gICAgICAgICNlbmRcclxuICAgICAgYCksXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBRdWVyeSBSZXNvbHZlcnNcclxuXHJcbiAgICAvLyBnZXRSb29tIHF1ZXJ5IC0gcmV1c2Ugcm9vbSBkYXRhIHNvdXJjZVxyXG4gICAgcm9vbURhdGFTb3VyY2UuY3JlYXRlUmVzb2x2ZXIoJ0dldFJvb21SZXNvbHZlcicsIHtcclxuICAgICAgdHlwZU5hbWU6ICdRdWVyeScsXHJcbiAgICAgIGZpZWxkTmFtZTogJ2dldFJvb20nLFxyXG4gICAgICByZXF1ZXN0TWFwcGluZ1RlbXBsYXRlOiBhcHBzeW5jLk1hcHBpbmdUZW1wbGF0ZS5mcm9tU3RyaW5nKGBcclxuICAgICAgICB7XHJcbiAgICAgICAgICBcInZlcnNpb25cIjogXCIyMDE3LTAyLTI4XCIsXHJcbiAgICAgICAgICBcIm9wZXJhdGlvblwiOiBcIkludm9rZVwiLFxyXG4gICAgICAgICAgXCJwYXlsb2FkXCI6IHtcclxuICAgICAgICAgICAgXCJvcGVyYXRpb25cIjogXCJnZXRSb29tXCIsXHJcbiAgICAgICAgICAgIFwidXNlcklkXCI6IFwiJGNvbnRleHQuaWRlbnRpdHkuc3ViXCIsXHJcbiAgICAgICAgICAgIFwicm9vbUlkXCI6IFwiJGNvbnRleHQuYXJndW1lbnRzLmlkXCJcclxuICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICAgIGApLFxyXG4gICAgICByZXNwb25zZU1hcHBpbmdUZW1wbGF0ZTogYXBwc3luYy5NYXBwaW5nVGVtcGxhdGUuZnJvbVN0cmluZyhgXHJcbiAgICAgICAgI2lmKCRjb250ZXh0LmVycm9yKVxyXG4gICAgICAgICAgJHV0aWwuZXJyb3IoJGNvbnRleHQuZXJyb3IubWVzc2FnZSwgJGNvbnRleHQuZXJyb3IudHlwZSlcclxuICAgICAgICAjZW5kXHJcbiAgICAgICAgI2lmKCRjb250ZXh0LnJlc3VsdC5zdGF0dXNDb2RlID09IDIwMClcclxuICAgICAgICAgICR1dGlsLnRvSnNvbigkY29udGV4dC5yZXN1bHQuYm9keSlcclxuICAgICAgICAjZWxzZVxyXG4gICAgICAgICAgJHV0aWwuZXJyb3IoJGNvbnRleHQucmVzdWx0LmJvZHkuZXJyb3IsIFwiQmFkUmVxdWVzdFwiKVxyXG4gICAgICAgICNlbmRcclxuICAgICAgYCksXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBnZXRNeU1hdGNoZXMgcXVlcnlcclxuICAgIG1hdGNoRGF0YVNvdXJjZS5jcmVhdGVSZXNvbHZlcignR2V0TXlNYXRjaGVzUmVzb2x2ZXInLCB7XHJcbiAgICAgIHR5cGVOYW1lOiAnUXVlcnknLFxyXG4gICAgICBmaWVsZE5hbWU6ICdnZXRNeU1hdGNoZXMnLFxyXG4gICAgICByZXF1ZXN0TWFwcGluZ1RlbXBsYXRlOiBhcHBzeW5jLk1hcHBpbmdUZW1wbGF0ZS5mcm9tU3RyaW5nKGBcclxuICAgICAgICB7XHJcbiAgICAgICAgICBcInZlcnNpb25cIjogXCIyMDE3LTAyLTI4XCIsXHJcbiAgICAgICAgICBcIm9wZXJhdGlvblwiOiBcIkludm9rZVwiLFxyXG4gICAgICAgICAgXCJwYXlsb2FkXCI6IHtcclxuICAgICAgICAgICAgXCJvcGVyYXRpb25cIjogXCJnZXRVc2VyTWF0Y2hlc1wiLFxyXG4gICAgICAgICAgICBcInVzZXJJZFwiOiBcIiRjb250ZXh0LmlkZW50aXR5LnN1YlwiXHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgICBgKSxcclxuICAgICAgcmVzcG9uc2VNYXBwaW5nVGVtcGxhdGU6IGFwcHN5bmMuTWFwcGluZ1RlbXBsYXRlLmZyb21TdHJpbmcoYFxyXG4gICAgICAgICNpZigkY29udGV4dC5lcnJvcilcclxuICAgICAgICAgICR1dGlsLmVycm9yKCRjb250ZXh0LmVycm9yLm1lc3NhZ2UsICRjb250ZXh0LmVycm9yLnR5cGUpXHJcbiAgICAgICAgI2VuZFxyXG4gICAgICAgICNpZigkY29udGV4dC5yZXN1bHQuc3RhdHVzQ29kZSA9PSAyMDApXHJcbiAgICAgICAgICAkdXRpbC50b0pzb24oJGNvbnRleHQucmVzdWx0LmJvZHkubWF0Y2hlcylcclxuICAgICAgICAjZWxzZVxyXG4gICAgICAgICAgJHV0aWwuZXJyb3IoJGNvbnRleHQucmVzdWx0LmJvZHkuZXJyb3IsIFwiQmFkUmVxdWVzdFwiKVxyXG4gICAgICAgICNlbmRcclxuICAgICAgYCksXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBjaGVja1Jvb21NYXRjaCBxdWVyeVxyXG4gICAgbWF0Y2hEYXRhU291cmNlLmNyZWF0ZVJlc29sdmVyKCdDaGVja1Jvb21NYXRjaFJlc29sdmVyJywge1xyXG4gICAgICB0eXBlTmFtZTogJ1F1ZXJ5JyxcclxuICAgICAgZmllbGROYW1lOiAnY2hlY2tSb29tTWF0Y2gnLFxyXG4gICAgICByZXF1ZXN0TWFwcGluZ1RlbXBsYXRlOiBhcHBzeW5jLk1hcHBpbmdUZW1wbGF0ZS5mcm9tU3RyaW5nKGBcclxuICAgICAgICB7XHJcbiAgICAgICAgICBcInZlcnNpb25cIjogXCIyMDE3LTAyLTI4XCIsXHJcbiAgICAgICAgICBcIm9wZXJhdGlvblwiOiBcIkludm9rZVwiLFxyXG4gICAgICAgICAgXCJwYXlsb2FkXCI6IHtcclxuICAgICAgICAgICAgXCJvcGVyYXRpb25cIjogXCJjaGVja1Jvb21NYXRjaFwiLFxyXG4gICAgICAgICAgICBcInJvb21JZFwiOiBcIiRjb250ZXh0LmFyZ3VtZW50cy5yb29tSWRcIlxyXG4gICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuICAgICAgYCksXHJcbiAgICAgIHJlc3BvbnNlTWFwcGluZ1RlbXBsYXRlOiBhcHBzeW5jLk1hcHBpbmdUZW1wbGF0ZS5mcm9tU3RyaW5nKGBcclxuICAgICAgICAjaWYoJGNvbnRleHQuZXJyb3IpXHJcbiAgICAgICAgICAkdXRpbC5lcnJvcigkY29udGV4dC5lcnJvci5tZXNzYWdlLCAkY29udGV4dC5lcnJvci50eXBlKVxyXG4gICAgICAgICNlbmRcclxuICAgICAgICAjaWYoJGNvbnRleHQucmVzdWx0LnN0YXR1c0NvZGUgPT0gMjAwKVxyXG4gICAgICAgICAgJHV0aWwudG9Kc29uKCRjb250ZXh0LnJlc3VsdC5ib2R5Lm1hdGNoKVxyXG4gICAgICAgICNlbHNlXHJcbiAgICAgICAgICAkdXRpbC5lcnJvcigkY29udGV4dC5yZXN1bHQuYm9keS5lcnJvciwgXCJCYWRSZXF1ZXN0XCIpXHJcbiAgICAgICAgI2VuZFxyXG4gICAgICBgKSxcclxuICAgIH0pO1xyXG5cclxuICAgIGNvbnNvbGUubG9nKCdBcHBTeW5jIHJlc29sdmVycyBjcmVhdGVkIHN1Y2Nlc3NmdWxseScpO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBjcmVhdGVPdXRwdXRzKCkge1xyXG4gICAgLy8gT3V0cHV0IHZhbHVlcyBuZWVkZWQgZm9yIG1vYmlsZSBhcHAgY29uZmlndXJhdGlvblxyXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ1VzZXJQb29sSWQnLCB7XHJcbiAgICAgIHZhbHVlOiB0aGlzLnVzZXJQb29sLnVzZXJQb29sSWQsXHJcbiAgICAgIGRlc2NyaXB0aW9uOiAnQ29nbml0byBVc2VyIFBvb2wgSUQnLFxyXG4gICAgICBleHBvcnROYW1lOiAnVHJpbml0eVVzZXJQb29sSWQnLFxyXG4gICAgfSk7XHJcblxyXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ1VzZXJQb29sQ2xpZW50SWQnLCB7XHJcbiAgICAgIHZhbHVlOiB0aGlzLnVzZXJQb29sQ2xpZW50LnVzZXJQb29sQ2xpZW50SWQsXHJcbiAgICAgIGRlc2NyaXB0aW9uOiAnQ29nbml0byBVc2VyIFBvb2wgQ2xpZW50IElEJyxcclxuICAgICAgZXhwb3J0TmFtZTogJ1RyaW5pdHlVc2VyUG9vbENsaWVudElkJyxcclxuICAgIH0pO1xyXG5cclxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdHcmFwaFFMRW5kcG9pbnQnLCB7XHJcbiAgICAgIHZhbHVlOiB0aGlzLmFwaS5ncmFwaHFsVXJsLFxyXG4gICAgICBkZXNjcmlwdGlvbjogJ0FwcFN5bmMgR3JhcGhRTCBBUEkgRW5kcG9pbnQnLFxyXG4gICAgICBleHBvcnROYW1lOiAnVHJpbml0eUdyYXBoUUxFbmRwb2ludCcsXHJcbiAgICB9KTtcclxuXHJcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnQVdTUmVnaW9uJywge1xyXG4gICAgICB2YWx1ZTogdGhpcy5yZWdpb24sXHJcbiAgICAgIGRlc2NyaXB0aW9uOiAnQVdTIFJlZ2lvbicsXHJcbiAgICAgIGV4cG9ydE5hbWU6ICdUcmluaXR5QVdTUmVnaW9uJyxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIFRhYmxlIG5hbWVzIGZvciBMYW1iZGEgZnVuY3Rpb25zXHJcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnUm9vbXNUYWJsZU5hbWUnLCB7XHJcbiAgICAgIHZhbHVlOiB0aGlzLnJvb21zVGFibGUudGFibGVOYW1lLFxyXG4gICAgICBkZXNjcmlwdGlvbjogJ0R5bmFtb0RCIFJvb21zIFRhYmxlIE5hbWUnLFxyXG4gICAgfSk7XHJcblxyXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ1ZvdGVzVGFibGVOYW1lJywge1xyXG4gICAgICB2YWx1ZTogdGhpcy52b3Rlc1RhYmxlLnRhYmxlTmFtZSxcclxuICAgICAgZGVzY3JpcHRpb246ICdEeW5hbW9EQiBWb3RlcyBUYWJsZSBOYW1lJyxcclxuICAgIH0pO1xyXG5cclxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdNYXRjaGVzVGFibGVOYW1lJywge1xyXG4gICAgICB2YWx1ZTogdGhpcy5tYXRjaGVzVGFibGUudGFibGVOYW1lLFxyXG4gICAgICBkZXNjcmlwdGlvbjogJ0R5bmFtb0RCIE1hdGNoZXMgVGFibGUgTmFtZScsXHJcbiAgICB9KTtcclxuXHJcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnVXNlcnNUYWJsZU5hbWUnLCB7XHJcbiAgICAgIHZhbHVlOiB0aGlzLnVzZXJzVGFibGUudGFibGVOYW1lLFxyXG4gICAgICBkZXNjcmlwdGlvbjogJ0R5bmFtb0RCIFVzZXJzIFRhYmxlIE5hbWUnLFxyXG4gICAgfSk7XHJcbiAgfVxyXG59Il19