import { string } from "mathjs";
import { GameObject } from "./game";
import { Player } from "./player";

export const enum LaneDirection {
  LEFT = -1,
  RIGHT = 1,
}

export const enum ObstacleSpeeds {
  STOPPED = 0,
  SLOW = 4,
  MEDIUM = 10,
  FAST = 14,
}

/**
 * Indicate how to avoid obstacles
 */
export enum ObstacleAvoidanceType {
  NONE,
  BRAKE,
  PASS,
}

/** Draws lines for lanes. Could be hidden or dashed.  */
export class LaneLineStyle {
  constructor(
    public readonly color: string = "white",
    public readonly dashed: boolean = false,
    public readonly hidden: boolean = false,
    public readonly lineWidth: number = 2,
    public readonly dashLength: number = 40,
    public readonly dashOffLength: number = 80,
  ) {}
}

/** styles for both lines of a lane.  Top and bottom as oriented in the scene.  */
export class LaneLinesStyles {
  constructor(
    public readonly top: LaneLineStyle = new LaneLineStyle(),
    public readonly bottom: LaneLineStyle = new LaneLineStyle(),
  ) {}
}

export class Obstacle extends GameObject {
  constructor(
    x: number,
    y: number,
    width: number,
    height: number,
    public readonly speed: number,
    public readonly direction: LaneDirection,
    image?: HTMLImageElement,
    public readonly avoidance: ObstacleAvoidanceType = ObstacleAvoidanceType.NONE,
    public readonly detectCollisions: boolean = false,
    public readonly emergencyVehicle: boolean = false,
    private readonly originalSpeed: ObstacleSpeeds = speed,
    private readonly originalY: number = y,
  ) {
    // some obstacles are hidden so image can be undefined
    super(x, y, width, height, image, direction === LaneDirection.LEFT);
  }

  public static getCrashedImage(): HTMLImageElement {
    const image = new Image();
    image.src = "images/obstacles/crashed.png";
    return image;
  }

  /** Helps the producers create a new obstacle in the given location.  */
  public clone(x: number = this.x, y: number = this.y) {
    return new Obstacle(
      x,
      y,
      this.width,
      this.height,
      this.speed,
      this.direction,
      this.image,
      this.avoidance,
      this.detectCollisions,
      this.emergencyVehicle,
      this.originalSpeed,
      this.originalY,
    );
  }

  public moveObstacle(
    player: Player,
    obstacles: readonly Obstacle[],
  ): Obstacle {
    const collided = this.detectCollisions && this.collisionDetected(obstacles);
    if (collided) {
      return new Obstacle(
        this.x,
        this.y,
        this.width,
        this.height,
        ObstacleSpeeds.STOPPED,
        this.direction,
        Obstacle.getCrashedImage(),
        ObstacleAvoidanceType.NONE,
        false, // no collision detection for crashed obstacles
        false, // crash is no longer emergency vehicle
        this.originalSpeed,
        this.originalY,
      );
    }
    const adjustedSpeed = this.calculateSpeed(player, obstacles);
    const newX = this.x + adjustedSpeed * this.direction;
    const newY = this.calculateYForPassing(player, obstacles);
    return new Obstacle(
      newX,
      newY,
      this.width,
      this.height,
      adjustedSpeed,
      this.direction,
      this.image,
      this.avoidance,
      this.detectCollisions,
      this.emergencyVehicle,
      this.originalSpeed,
      this.originalY,
    );
  }

  /** Returns true if this obstacle is colliding with any other obstacle
   *
   * @param obstacles
   */
  public collisionDetected(obstacles: readonly Obstacle[]) {
    const collision = obstacles.some((obstacle) => {
      if (obstacle === this) {
        return false;
      }
      return this.intersects(obstacle);
    });
    return collision;
  }

  private getClosestObject(
    gameObjects: readonly GameObject[],
  ): GameObject | undefined {
    let closestObstacle: GameObject | undefined;
    let closestDistance = Infinity;

    gameObjects.forEach((gameObject) => {
      const isObjectInLane =
        gameObject.y >= this.y - this.height &&
        gameObject.y <= this.y + this.height;
      const isObjectInFront =
        isObjectInLane &&
        ((this.direction === LaneDirection.RIGHT && this.x < gameObject.x) ||
          (this.direction === LaneDirection.LEFT && this.x > gameObject.x));
      if (isObjectInFront) {
        const distance = Math.abs(this.x - gameObject.x);
        if (distance < closestDistance) {
          closestDistance = distance;
          closestObstacle = gameObject;
        }
      }
    });

    return closestObstacle;
  }

  public calculateTimeToCollision(
    gameObjects: GameObject[],
  ): number | undefined {
    const closestObstacle = this.getClosestObject(gameObjects);
    if (!closestObstacle) {
      return undefined;
    }

    const distanceToClosestObstacle = this.getDistanceTo(closestObstacle);

    // Calculate relative speed between this obstacle and the closest obstacle
    const relativeSpeed =
      this.speed -
      (closestObstacle instanceof Obstacle
        ? (closestObstacle as Obstacle).speed
        : 0);

    // If the relative speed is negative, the objects are moving away from each other
    if (relativeSpeed <= 0) {
      return -Infinity;
    }

    // Calculate time to collision
    const timeToCollision = distanceToClosestObstacle / relativeSpeed;

    return timeToCollision;
  }

  private getDistanceTo(gameObject: GameObject): number {
    return Math.abs(this.x - gameObject.x);
  }

  private calculateDistanceToClosestObject(gameObjects: GameObject[]): number {
    const closest = this.getClosestObject(gameObjects);
    if (closest) {
      return this.getDistanceTo(closest);
    }
    return Infinity;
  }

  /**
   * Calculates the speed of the street object based on the player's position and obstacles on the street.
   * If the player is in front of the obstacle, the obstacle will slow down if braking is enabled.
   * If the player is behind the obstacle, the obstacle will speed up if going braking is enabled.
   * @param player - The player object on the street.
   * @param obstacles - An array of obstacles on the street.
   * @returns The speed of the street object.
   */
  private calculateSpeed(
    player: Player,
    obstacles: readonly Obstacle[],
  ): number {
    if (this.avoidance === ObstacleAvoidanceType.BRAKE) {
      // combine player and obstacles treating the same.  Exclude this obstacle
      const gameObjects: GameObject[] = [...obstacles, player].filter(
        (gameObject) => gameObject !== this,
      );

      const timeToCollision = this.calculateTimeToCollision(gameObjects);
      let newSpeed = this.speed;
      if (timeToCollision && timeToCollision > 0 && timeToCollision < 100) {
        // If time to collision is less than a certain threshold, slow down
        newSpeed -= 0.5; // Reduce speed by 10%
      }

      const distanceToClosest =
        this.calculateDistanceToClosestObject(gameObjects);
      if (distanceToClosest < 200) {
        newSpeed -= 0.5;
      }
      if (distanceToClosest < 100 || this.emergencyVehicleDetected(obstacles)) {
        newSpeed -= 1;
      } else if (this.originalSpeed && newSpeed < this.originalSpeed) {
        newSpeed += 0.25;
      }

      return Math.max(newSpeed, 0); // Ensure the speed is never negative
    }

    return this.speed;
  }

  /** Returns true if an emergency vehicle is detected in the obstacles given
   *
   * @param obstacles any collection of obstacles where emergency vehicles may be found
   * @returns true if an emergency vehicle is detected in the obstacles given
   */
  private emergencyVehicleDetected(obstacles: readonly Obstacle[]): boolean {
    const emergencyVehicleDetected = obstacles.some((obstacle) => {
      if (obstacle === this) {
        return false;
      }
      return obstacle.emergencyVehicle;
    });
    return emergencyVehicleDetected;
  }

  /**
   * Determine a new y which may be the same as this.
   * If the obstacle is going to collide with another obstacle,
   * it will change lanes if ObstacleAvoidanceType is PASS.
   * The passing vehicle never returns to its original lane.
   * This is intended to demonstrate bicycle and vehicles passing each other
   * on the shared street so using Heavy Traffic provides the best demonstration.
   *
   * @param player to be considered for collision avoidance. It won't pass the player
   * @param obstacles will pass these obstacles if blocked
   * @returns
   */
  public calculateYForPassing(
    player: Player,
    obstacles: readonly Obstacle[],
  ): number {
    if (this.avoidance !== ObstacleAvoidanceType.PASS) {
      return this.y;
    }
    const closestObstacle = this.getClosestObject(obstacles) as Obstacle;

    if (!closestObstacle) {
      return this.y;
    }
    //only pass slower objects. If this is a slow object, put it back in the original lane
    if (this.speed < closestObstacle.speed) {
      return this.originalY;
    }

    // return to original lane if safe to do so
    const distanceAwayFromOriginal = Math.abs(this.originalY - this.y);
    if (distanceAwayFromOriginal > this.height) {
      const returnPreview = this.clone(this.x, this.originalY);
      if (!returnPreview.collisionDetected(obstacles)) {
        const closestIfReturned = returnPreview.getClosestObject(obstacles);
        if (!closestIfReturned) {
          return this.originalY; // abrupt return could be smoothed out
        }
        if (returnPreview.getDistanceTo(closestIfReturned) > 5 * this.width) {
          return this.originalY; // abrupt return could be smoothed out
        }
      }
    }
    if (this.getDistanceTo(closestObstacle) > 2 * this.width) {
      return this.y;
    }

    let newY = this.y;
    const directionMultiplier = this.direction === LaneDirection.RIGHT ? -1 : 1; // -1 for right, 1 for left
    const yAdjustment = 8 * directionMultiplier; // Adjust based on lane direction

    //only adjust if the new y is not too far from the original
    const maxPassDistance = this.height;
    if (distanceAwayFromOriginal < maxPassDistance) {
      newY = this.y + yAdjustment;
    }

    return newY;
  }
}

/**
 * Produces obstacles in a lane based on the given template.
 */
export class ObstacleProducer {
  private lastObstacleTime: number = 0;

  /**
   * Creates an instance of ObstacleProducer.
   * @param template The obstacle template to produce others.
   * @param maxFrequencyInSeconds The maximum frequency in seconds at which obstacles can be produced. It helps throttle the level of traffic.
   * @param assignX If true, the x value will be assigned in the next method.  False keeps the x value of the template.
   * @param randomizeTraffic True will pick only one producer at random. False will produce from all producers if ready.
   */
  constructor(
    public readonly template: Obstacle,
    public readonly maxFrequencyInSeconds: number = 1,
    public readonly assignX: boolean = true,
    public readonly randomizeTraffic: boolean = true,
  ) {}

  /**
   * @param player The player's position may be used to determine if the producer is ready to produce another obstacle.
   * @returns True if the producer is ready to produce another obstacle, false otherwise.
   */
  public readyForNext(objects:readonly GameObject[]): boolean {
    const currentTime = Date.now();
    const timeSinceLastObstacle = (currentTime - this.lastObstacleTime) / 1000;
    return timeSinceLastObstacle > this.maxFrequencyInSeconds;
  }

  public next(x: number): Obstacle {
    //override x unless told not to
    if (!this.assignX) {
      x = this.template.x;
    }
    const obstacle = this.template.clone(x);
    this.lastObstacleTime = Date.now();
    return obstacle;
  }
}

/**
 * A class that produces obstacles at a certain frequency,
 * but only when the player intersects with a target object.
 * @extends ObstacleProducer
 */
export class TargetObstacleProducer extends ObstacleProducer {
  /**
   * Creates a new instance of TargetObstacleProducer.
   * @param template - The obstacle template to use.
   * @param maxFrequencyInSeconds - The maximum frequency at which to produce obstacles.
   * @param assignX - Whether to assign the obstacle's X position randomly.
   * @param target - The target object that the player must intersect with in order for obstacles to be produced.
   */
  constructor(
    template: Obstacle,
    maxFrequencyInSeconds: number,
    assignX: boolean,
    public readonly target: GameObject,
  ) {
    super(template, maxFrequencyInSeconds, assignX, false); // do not randomize traffic
  }

  /**
   * Determines whether the producer is ready to produce the next obstacle.
   * @param player - The player object to check for intersection with the target object.
   * @returns True if the producer is ready and the player intersects with the target object, false otherwise.
   */
  public readyForNext(objects:readonly GameObject[]): boolean {
    const ready = super.readyForNext(objects);
    if (ready) {
      const player = objects.find((object) => object instanceof Player);
      if (!player) {
        throw new Error("Player not found and is required for TargetObstacleProducer.readyForNext");
      }
      const intersects = player.intersects(this.target);
      return intersects;
    }
    return false;
  }
}

/**
 * Represents a lane in a street with lane lines and obstacles.
 */
export class Lane {
  /**
   * Creates a new instance of Lane.
   * @param direction - The direction of the lane.
   * @param laneWidth - The width of the lane.
   * @param streetLength - The length of the street.
   * @param centerY - The y-coordinate of the center of the lane.
   * @param lineStyle - The style of the lane lines.
   * @param obstacleProducers - The obstacle producers for the lane.
   * @param obstacles - The obstacles in the lane.
   */
  constructor(
    public readonly direction: LaneDirection,
    public readonly laneWidth: number,
    public readonly streetLength: number,
    public readonly centerY: number,
    public readonly lineStyle: LaneLinesStyles = new LaneLinesStyles(),
    public readonly obstacleProducers: readonly ObstacleProducer[] = [],
    public readonly obstacles: readonly Obstacle[] = [],
  ) {}

  /**
   * Adds an obstacle to the lane.
   * @param obstacle - The obstacle to add.
   * @returns A new instance of Lane with the added obstacle.
   */
  public addObstacle(obstacle: Obstacle): Lane {
    const newObstacles = [...this.obstacles, obstacle];
    return new Lane(
      this.direction,
      this.laneWidth,
      this.streetLength,
      this.centerY,
      this.lineStyle,
      this.obstacleProducers,
      newObstacles,
    );
  }

  /**
   * Updates the obstacles in the lane.
   * @returns A new instance of Lane with the updated obstacles.
   */
  public updateObstacles(player: Player, obstacles: readonly Obstacle[]): Lane {
    const newObstacles = this.obstacles
      .map((obstacle) => obstacle.moveObstacle(player, obstacles))
      .filter((obstacle) => {
        if (this.direction === LaneDirection.LEFT) {
          return obstacle.x + obstacle.width > 0;
        } else {
          return obstacle.x < this.streetLength;
        }
      });

    return new Lane(
      this.direction,
      this.laneWidth,
      this.streetLength,
      this.centerY,
      this.lineStyle,
      this.obstacleProducers,
      newObstacles,
    );
  }

  /**
   * Draws the lane on the canvas with lane lines and obstacles.
   * @param ctx - The canvas rendering context to draw on.
   */
  public draw(ctx: CanvasRenderingContext2D): void {
    // Calculate the top position of the lane
    const positionY = this.centerY - this.laneWidth / 2;

    this.drawLaneLine(ctx, positionY, this.lineStyle.top, 5);
    this.drawLaneLine(ctx, positionY + this.laneWidth, this.lineStyle.bottom);

    // Draw obstacles
    for (const obstacle of this.obstacles) {
      obstacle.draw(ctx);
    }
  }

  /**
   * Draws a lane line on the canvas context.
   * @param ctx - The canvas rendering context to draw on.
   * @param positionY - The y-coordinate of the lane line.
   * @param lineStyle - The style of the lane line.
   * @param offset - The optional offset to avoid line overlapping.
   */
  private drawLaneLine(
    ctx: CanvasRenderingContext2D,
    positionY: number,
    lineStyle: LaneLineStyle,
    offset: number = 0,
  ) {
    if (!lineStyle.hidden) {
      ctx.strokeStyle = lineStyle.color;
      ctx.lineWidth = lineStyle.lineWidth;

      if (lineStyle.dashed) {
        ctx.setLineDash([lineStyle.dashLength, lineStyle.dashOffLength]);
      } else {
        ctx.setLineDash([]);
      }

      ctx.beginPath();
      const y = positionY + offset;
      ctx.moveTo(0, y);
      ctx.lineTo(this.streetLength, y);
      ctx.stroke();
    }
  }

  /**
   * Detects collision between the player and the obstacles in the lane.
   * @param playerX - The x coordinate of the player.
   * @param playerY - The y coordinate of the player.
   * @returns True if there is a collision, false otherwise.
   */
  public detectCollision(player: Player): boolean {
    // Calculate the top position of the lane
    const positionY = this.centerY - this.laneWidth / 2;

    for (const obstacle of this.obstacles) {
      if (player.intersects(obstacle)) {
        return true;
      }
    }
    return false;
  }
}

/**
 * A street consists of lanes that travel horizontally across the canvas.
 * The lanes may have obstacles that travel in the same direction as the lane.
 * The obstacles may conflict with the player.
 * @class
 */
export class Street {
  constructor(
    public readonly topOfStreetY: number = 0,
    public readonly streetLength: number = 600,
    public readonly lanes: readonly Lane[] = [],
    public readonly sceneObjects: readonly GameObject[] = [],
  ) {}

  public clone(
    lanes: readonly Lane[] = this.lanes,
    sceneObjects: readonly GameObject[] = this.sceneObjects,
  ): Street {
    return new Street(
      this.topOfStreetY,
      this.streetLength,
      lanes,
      sceneObjects,
    );
  }

  public addLane(
    direction: LaneDirection,
    laneWidth: number,
    style: LaneLinesStyles,
    obstacleProducers: readonly ObstacleProducer[] = [],
  ): Street {
    const newLanes = [
      ...this.lanes,
      new Lane(
        direction,
        laneWidth,
        this.streetLength,
        this.getCenterY(laneWidth),
        style,
        obstacleProducers,
      ),
    ];
    return this.clone(newLanes);
  }

  public addSceneObject(sceneObject: GameObject): Street {
    const newSceneObjects = [...this.sceneObjects, sceneObject];
    return this.clone(this.lanes, newSceneObjects);
  }

  private getCenterY(laneWidth: number): number {
    const streetWidth = this.getStreetWidth();
    return this.topOfStreetY + streetWidth + laneWidth / 2;
  }

  /** Called periodically, this iterates each lane's ObstacleProducer which
   * will generate an obstacle at the appropriate moment in the scenario
   * and be added to the list of obstacles for the lane.
   * @param player The player's position may be used to determine if the producer is ready to produce another obstacle.
   */
  public generateObstacles(player: Player): Street {
    const maxPerLane = 15;
    const randomLaneIndex = Math.floor(Math.random() * this.lanes.length);
    const newLanes = this.lanes.map((lane, index) => {
      if (index === randomLaneIndex) {
        if (lane.obstacles.length < maxPerLane) {
          const offsetOffCanvas = 50;
          const x =
            lane.direction === LaneDirection.LEFT
              ? lane.streetLength + offsetOffCanvas
              : 0 - offsetOffCanvas;
          const producersCount = lane.obstacleProducers.length;
          const randomProducerIndex = Math.floor(
            Math.random() * producersCount,
          );
          const objects =[...lane.obstacles, ...this.sceneObjects, player]
          lane.obstacleProducers.map((producer, index) => {
            if (producer.readyForNext(objects)) {
              if (!producer.randomizeTraffic || index === randomProducerIndex) {
                // only produce if a safe location is found
                let safeX = x;
                let newObstacle;
                let attempts = 0; // circuit breaker
                do {
                  newObstacle = producer.next(safeX);
                  safeX += 2 * newObstacle.width * -lane.direction; // grows off screen
                  attempts++;
                } while (
                  attempts < 3 &&
                  newObstacle.collisionDetected(lane.obstacles)
                );
                lane = lane.addObstacle(newObstacle);
              }
            }
          });
        }
      }
      return lane;
    });
    return this.clone(newLanes);
  }

  public updateObstacles(
    player: Player,
    obstacles: readonly Obstacle[],
  ): Street {
    const newLanes = this.lanes.map((lane) =>
      lane.updateObstacles(player, obstacles),
    );
    const newSceneObjects = this.sceneObjects.map((sceneObject) =>
      sceneObject.update([...obstacles,player]),
    );
    return this.clone(newLanes, newSceneObjects);
  }

  /**
   * Detects collision between the player and the obstacles in all lanes.
   * @param {number} playerX - The x coordinate of the player.
   * @param {number} playerY - The y coordinate of the player.
   * @returns {boolean} - True if there is a collision, false otherwise.
   */
  public detectCollision(player: Player): boolean {
    for (const lane of this.lanes) {
      if (lane.detectCollision(player)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Draws the street on the canvas with all lanes and obstacles.
   * @param {CanvasRenderingContext2D} ctx - The canvas rendering context to draw on.
   * @returns {void}
   */
  public draw(ctx: CanvasRenderingContext2D): void {
    for (const lane of this.lanes) {
      lane.draw(ctx);
    }

    for (const sceneObject of this.sceneObjects) {
      sceneObject.draw(ctx);
    }
  }

  public getStreetWidth(): number {
    return this.lanes.reduce(
      (totalWidth, lane) => totalWidth + lane.laneWidth,
      0,
    );
  }

  /**
   * Gets all obstacles from all lanes.
   * @returns An array of all obstacles.
   */
  public getAllObstacles(): readonly Obstacle[] {
    return this.lanes.flatMap((lane) => lane.obstacles);
  }
}

/**
 * A crosswalk sign warning vehicles when a pedestrian is crossing the street.
 * Rapid flashing beacon (RFB) flashes when the player is in the target area. 
 * 
 */
export class CrosswalkSign extends GameObject {
  /**
   * 
   * @param x horizontal location of the post of the sign.
   * @param y vertical location of the post of the sign. 
   * @param direction 
   * @param crosswalk 
   */
  constructor(
    x: number,
    y: number,
    public readonly direction: LaneDirection,
    public readonly crosswalk: GameObject,
    public readonly flashing: boolean = false,
    public readonly flashingSequence: boolean = false,
    public readonly timestampOfPreviousFlash: number = 0,
    public readonly notFlashingImage: HTMLImageElement = CrosswalkSign.getNotFlashinImage(),
    public readonly flashingImage: HTMLImageElement = CrosswalkSign.getFlashingImage(),
  ) {
    super(
      x,
      y,
      CrosswalkSign.getImageWidth(),
      CrosswalkSign.getImageHeight(),
      flashing ?  flashingImage : notFlashingImage,
      CrosswalkSign.calculateFlipHorizontal(flashing,flashingSequence,direction),
      CrosswalkSign.calculateAngle(flashing,flashingSequence,direction),
    );
  }

  /** Called during update indicating which of the sign's beacon should be lit up.
   * 
   * @param sequence simply a binary indicator to switch between beacons. Which beacon doesn't matter, as long as they switch. 
   */
  public flash(sequence:boolean):CrosswalkSign{
    return new CrosswalkSign(
      this.x,
      this.y,
      this.direction,
      this.crosswalk,
      true,
      sequence,
      Date.now(),
      this.notFlashingImage,
      this.flashingImage,
    );
  }

  public update(others: readonly GameObject[]): GameObject {
    // if the player is in the crosswalk, flash the beacon
    // find the player in the others
    const player = others.find((other) => other instanceof Player);
    if (this.flashing || player && player.intersects(this.crosswalk)) {
      const now = Date.now();
      const timeSinceLastFlash = now - this.timestampOfPreviousFlash;
      if (timeSinceLastFlash > CrosswalkSign.getFlashIntervalInMilliseconds()) {
        return this.flash(!this.flashingSequence);
      }
    }
    return this;
  }

  private static calculateFlipHorizontal(flashing:boolean,flashingSequence:boolean,direction: LaneDirection): boolean {
    if(!flashing){
      return false;
    }
    if(direction === LaneDirection.RIGHT){
      return !flashingSequence;
    } else {
      return flashingSequence;
    }
  }
  private static calculateAngle(flashing:boolean,flashingSequence:boolean,direction: LaneDirection): number {
    if(!flashing){
      return 0;
    }
    if(direction === LaneDirection.RIGHT){
      if (flashingSequence) {
        return 0;
      } else {
        return Math.PI;
      }
    } else {
      if(flashingSequence){
        return 0;
      } else {
        return Math.PI;
      }
    }
  }
  private static getImageScale(): number {
    return 0.1;
  } 

  private static getImageHeight(): number {
    return 342 * CrosswalkSign.getImageScale();
  }
  private static getImageWidth(): number {
    return 389 * CrosswalkSign.getImageScale();
  }
  private static getNotFlashinImage(): HTMLImageElement {
    const image = new Image();
    image.src = "images/scene/crosswalk-sign.png";
    return image;
  }

  private static getFlashingImage(): HTMLImageElement {
    const image = new Image();
    image.src = "images/scene/crosswalk-sign-flashing.png";
    return image;
  }

  private static getFlashIntervalInMilliseconds(): number {
    return 500;
  }
}

/**
 * Given the crosswalk sign, this produces an invisible obstacle that will stop
 * at the crosswalk stop line to block courteous vehicles when the sign is flashing.
 */
export class CrosswalkObstacleProducer extends ObstacleProducer {

  constructor(
    template: Obstacle
  ) {
    super(template, 100000, false, false); // do not randomize traffic
  }

  /**
   * 
   * @param player not used, but required by the base class
   * @returns true if the crosswalk sign is flashing and not yet produced. Only one is needed.
   */
  public readyForNext(objects:readonly GameObject[]): boolean {
    if( super.readyForNext(objects)){
      const sign = objects.find((object) => object instanceof CrosswalkSign) as CrosswalkSign;
      if (!sign) {
        throw new Error("CrosswalkSign not found and is required for CrosswalkObstacleProducer.readyForNext");
      }
      return sign.flashing;
    }
    return false;
  }
}