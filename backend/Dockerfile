# Render runs Java through Docker. Built from the backend folder.
FROM eclipse-temurin:17-jdk AS build
WORKDIR /app
COPY .mvn .mvn
COPY mvnw pom.xml ./
RUN chmod +x mvnw && sed -i 's/\r$//' mvnw && ./mvnw -q -B dependency:go-offline
COPY src src
# The tests already ran before deploying, and they aren't needed to build the image.
RUN ./mvnw -q -B package -DskipTests

FROM eclipse-temurin:17-jre
RUN useradd --system --no-create-home keepsake
USER keepsake
WORKDIR /app
COPY --from=build /app/target/keepsake-backend-*.jar app.jar
# Sized for Render's free plan: stays within 512 MB and starts as fast as it can.
ENV JAVA_TOOL_OPTIONS="-XX:MaxRAMPercentage=70 -XX:+UseSerialGC -XX:TieredStopAtLevel=1 -Xss512k"
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "app.jar"]
