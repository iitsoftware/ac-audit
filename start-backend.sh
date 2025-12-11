#!/bin/bash
cd "$(dirname "$0")"
cd backend
mvn clean compile exec:java -Dlogback.configurationFile=../config/logback.xml
