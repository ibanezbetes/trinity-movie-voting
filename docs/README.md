# 📚 Trinity Documentation

Complete technical and operational documentation for the Trinity Movie Chining App.

## 📖 Documentation Index

### Getting Started
- [Main README](../README.md) - Project overview and quick start
- [Mobile README](../mobile/README.md) - Mobile app documentation
- [Infrastructure README](../infrastructure/README.md) - AWS infrastructure details

### Deployment & Production
- [Deployment Guide](DEPLOYMENT_GUIDE.md) - Complete deployment instructions
- [Production Build Guide](PRODUCTION_BUILD_GUIDE.md) - Building for production
- **[Google Play Store Guide](GOOGLE_PLAY_STORE_GUIDE.md)** - Publishing to Play Store ⭐

### Technical Documentation
- [Technical Documentation](technical/README.md) - In-depth technical docs
- [App Architecture](technical/01-app-architecture.md)
- [Programming Languages](technical/02-programming-languages.md)
- [AWS Services](technical/03-aws-services.md)
- [Lambda Functions](technical/04-lambda-functions.md)
- [GraphQL Schema](technical/05-graphql-schema.md)
- [DynamoDB Tables](technical/06-dynamodb-tables.md)
- [Application Flows](technical/07-application-flows.md)

### Mobile App Publishing
- **[Google Play Store Guide](GOOGLE_PLAY_STORE_GUIDE.md)** - Complete step-by-step guide
- [Play Store Checklist](../mobile/PLAY_STORE_CHECKLIST.md) - Publication checklist
- [Publishing Summary](../mobile/PUBLISHING_SUMMARY.md) - Quick overview
- [Quick Commands](../mobile/QUICK_COMMANDS.md) - Command reference

### Project Specifications
- [Trinity Master Spec](TRINITY_MASTER_SPEC.md) - Complete project specification
- [Smart Random Discovery](SMART_RANDOM_DISCOVERY_ENHANCED.md) - Algorithm details

## 🚀 Quick Links

### For Developers
- [Setup Instructions](../README.md#quick-start)
- [Development Guide](../mobile/README.md#development)
- [Building Guide](../mobile/README.md#building)
- [Troubleshooting](../mobile/README.md#troubleshooting)

### For Publishing
- **[Google Play Store Guide](GOOGLE_PLAY_STORE_GUIDE.md)** ⭐
- [Create Keystore](../mobile/QUICK_COMMANDS.md#keystore-de-producción)
- [Generate AAB](../mobile/QUICK_COMMANDS.md#generar-aab-para-play-store)
- [Update Version](../mobile/QUICK_COMMANDS.md#actualizar-versión)

### For Operations
- [Deployment Guide](DEPLOYMENT_GUIDE.md)
- [Production Build Guide](PRODUCTION_BUILD_GUIDE.md)
- [Infrastructure Details](../infrastructure/README.md)

## 📱 Publishing to Google Play Store

### Quick Start

1. **Create Production Keystore** (first time only):
   ```bash
   cd mobile
   ./create-keystore.ps1
   ```

2. **Generate Android App Bundle**:
   ```bash
   ./generate-aab.ps1
   ```

3. **Upload to Play Console**:
   - Go to [Google Play Console](https://play.google.com/console)
   - Upload `android/app/build/outputs/bundle/release/app-release.aab`
   - Complete store listing and submit

### Complete Guide

📖 **[Google Play Store Publishing Guide](GOOGLE_PLAY_STORE_GUIDE.md)**

This comprehensive guide covers:
- ✅ Creating production keystore
- ✅ Configuring signing
- ✅ Generating AAB
- ✅ Play Console setup
- ✅ Store listing assets
- ✅ Internal testing
- ✅ Production release
- ✅ Future updates

## 🏗️ Architecture Overview

Trinity uses a serverless architecture built on AWS:

- **Frontend**: React Native + Expo SDK 52
- **Backend**: AWS CDK + TypeScript
- **API**: AWS AppSync (GraphQL)
- **Database**: Amazon DynamoDB
- **Authentication**: Amazon Cognito
- **Functions**: AWS Lambda (Node.js 18.x)
- **External API**: The Movie Database (TMDB)
- **Real-Time**: GraphQL Subscriptions

## 📞 Contact

- **Email**: trinity.app.spain@gmail.com
- **Instagram**: [@trinity.app](https://www.instagram.com/trinity.app/)
- **Website**: [trinity-app.es](https://trinity-app.es)

---

**Version**: 1.0.0  
**Last Updated**: 2026-02-08  
**Status**: ✅ Production Ready

*Stop Scroll Infinity - Ponte de acuerdo en un chin* 🎬✨
