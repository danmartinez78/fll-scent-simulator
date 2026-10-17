// Short explanations shown in info buttons and the Learn tab.
// Written for sixth graders: one or two sentences each.

export interface HelpTopic {
  title: string;
  text: string;
}

export const HELP: Record<string, HelpTopic> = {
  payload: {
    title: 'Payload',
    text: 'Payload is everything the drone carries: the liquid in its tank or the devices it will drop. A heavier payload drains the battery faster.'
  },
  flightTime: {
    title: 'Flight time',
    text: 'How long the drone can stay in the air on one battery. A full tank means less flight time; an empty tank means more.'
  },
  t50: {
    title: 'DJI Agras T50 reference',
    text: 'Default drone numbers are loosely based on the published DJI Agras T50 spec: 40 L tank, about 16.5 minutes of hover with no payload and about 7 minutes fully loaded. They are reference numbers, not a promise of real mission time.'
  },
  reserve: {
    title: 'Battery reserve',
    text: 'Pilots never use the whole battery. The drone heads home when it reaches the reserve, so it can land safely.'
  },
  applicationRate: {
    title: 'Application rate',
    text: 'How much liquid is sprayed on each acre. At 2 gallons per acre, a 10.5 gallon tank covers about 5.25 acres.'
  },
  swath: {
    title: 'Swath width',
    text: 'How wide a strip the drone sprays on each pass, like the width of a paint roller.'
  },
  turnaround: {
    title: 'Turnaround time',
    text: 'Time on the ground to refill the tank or swap the battery before the next flight.'
  },
  product: {
    title: 'Available product',
    text: 'The total amount of scent liquid the team has for this run. When it runs out, spraying stops.'
  },
  pheromone: {
    title: 'Pheromone',
    text: 'A pheromone is a scent insects use to send messages to each other, for example to find a mate. Some pest-control ideas use scents to confuse, push away or attract insects.'
  },
  repellent: {
    title: 'Repellent',
    text: 'A scent that pests tend to move away from. In this simulator it is a generic "Repellent A", not a real product.'
  },
  attractant: {
    title: 'Attractant',
    text: 'A scent that pests tend to move toward. Put a trap with it and pests that reach it get caught. It is a generic "Attractant B", not a real product.'
  },
  pushPull: {
    title: 'Push-pull',
    text: 'Push-pull uses two scents together: a repellent "pushes" pests off the crop while an attractant "pulls" them somewhere else, like a trap at the edge.'
  },
  slowRelease: {
    title: 'Slow-release source',
    text: 'A device that stays in one place and gives off scent a little at a time. It can last much longer than a spray, but only covers the area around it (and downwind).'
  },
  spray: {
    title: 'Spraying',
    text: 'The drone flies back and forth and sprays scent over the zones you draw. Wind pushes the falling drops downwind, so in a breeze the spray lands a little downwind of the drone and some blows off the field. The spray stays on the plants and wears off over about a week, but its smell drifts downwind.'
  },
  scentStrength: {
    title: 'Scent strength',
    text: 'How powerful the scent product is. Stronger scent stays above the "noticing" level for longer and farther away.'
  },
  scentLifetime: {
    title: 'Spray lasts on plants',
    text: 'Sprayed repellent coats the leaves and slowly wears off. After this long, about a third of it is left. Real repellent sprays usually work for about 5 to 14 days.'
  },
  treatStart: {
    title: 'When to start treating',
    text: 'Farmers usually find pests by scouting before they treat, so some feeding happens first. Starting early protects more of the crop but costs money before you know the pests are there. Waiting means you treat only when needed, but the crop is damaged in the meantime.'
  },
  buildUp: {
    title: 'Pests arriving',
    text: 'In a real field, pests do not all show up at once. A few are there at the start, and more fly in and land over the next days. Set this to 0 to have every pest there on Day 1.'
  },
  respray: {
    title: 'How often to spray',
    text: 'Sprayed repellent wears off after about a week, so farmers often spray again. Each repeat spray is a whole new drone mission: it uses more product, more flight time and costs more.'
  },
  timeLapse: {
    title: 'Two clocks',
    text: 'While a drone is flying, the clock runs in real time, so flight times are real minutes. When the drone is on the ground, the field runs as a time-lapse: at 1x, one second on screen is about four hours on the farm. Pests, crop damage and fading scent take days, just like on a real farm.'
  },
  scentRange: {
    title: 'Effective range',
    text: 'How far a slow-release device spreads its scent around itself before the wind carries it away.'
  },
  threshold: {
    title: 'Noticing threshold',
    text: 'Pests only react when the scent is stronger than this. Below it, they ignore the scent.'
  },
  effectiveness: {
    title: 'Scent effectiveness',
    text: 'How many pests react to the scent at all. At 80%, 8 out of 10 pests notice it and 2 ignore it and keep feeding. Pests that ignore the scent are shown in blue.'
  },
  perTrip: {
    title: 'Devices per trip',
    text: 'How many devices the drone\'s drop rack can hold at once. If the devices are heavy, the weight limit may let it carry fewer. More trips means more flying, battery swaps and time.'
  },
  sensitivity: {
    title: 'Pest sensitivity',
    text: 'How strongly pests react to scent. 0 means they ignore it completely.'
  },
  cropAttraction: {
    title: 'Crop attraction',
    text: 'How much pests want to be on the crop. Higher numbers make them come back faster after being pushed away.'
  },
  windPlume: {
    title: 'Wind plume',
    text: 'Wind carries scent downwind, so the scent stretches into a long shape called a plume. Strong wind carries it farther but also spreads it thinner.'
  },
  survey: {
    title: 'Survey drone',
    text: 'Some drones are built to carry liquid; others are built to take pictures and make maps. Does one drone need to do every job?'
  },
  surveyAccuracy: {
    title: 'Survey accuracy',
    text: 'The camera does not see every pest. Detection chance is how often it spots a pest it flies over. Fake detections are things (like leaves or shadows) mistaken for pests.'
  },
  computerVision: {
    title: 'Computer vision',
    text: 'A drone camera does not directly know how many pests exist. Software has to estimate what is happening from what the camera can see. Real computer vision needs lots of training pictures and testing before it can be trusted.'
  },
  optimization: {
    title: 'Optimization',
    text: 'Optimization means trying many possible answers and looking for one that works better according to the goal you choose. The computer here tries the obvious plans first, keeps the best, then makes small changes and keeps each one only if the score goes up.'
  },
  score: {
    title: 'Score',
    text: 'The score is how the computer judges a plan. You choose the weights, so you decide what "best" means.'
  },
  model: {
    title: 'Model',
    text: 'A simplified description of how something works, written as rules or math. Every simulator is a model, and every model leaves things out.'
  },
  calibration: {
    title: 'Calibrating',
    text: 'Changing a model\'s numbers so it matches what was measured in the real world. A calibrated model makes better predictions.'
  },
  validation: {
    title: 'Validating',
    text: 'Checking a model against real results it was not tuned to. If it predicts those well too, you can trust it more.'
  },
  seed: {
    title: 'Random seed',
    text: 'Pests move with some randomness. The same seed gives the exact same randomness, so you can repeat an experiment and change only one thing.'
  },
  cropProtected: {
    title: 'Crop protected',
    text: 'Percent of the crop that has not had much pest feeding yet. Pests feed when they sit on the crop without repellent around them.'
  },
  pestsDeterred: {
    title: 'Pests kept off the crop',
    text: 'Percent of the pests that have arrived that are not eating the crop: they are off the crop, caught in a trap, or bothered by repellent. During a run it shows right now; after the run it shows the average over the whole run.'
  },
  scentCoverage: {
    title: 'Scent coverage',
    text: 'Percent of the crop where repellent is strong enough for pests to notice right now.'
  },
  cost: {
    title: 'Estimated cost',
    text: 'Every drone mission costs about $5 for each minute in the air (pilot, equipment and batteries), whether it sprays or drops devices. For spraying that works out to about $12 to $16 per acre, a common benchmark. This simulator does not know the actual cost of the team\'s scent product, so product and device prices are guesses you can change.'
  }
};

/** Short version for the bar at the bottom of the page. */
export const MODEL_NOTE = 'This is a simplified model, not the real world, so its results do not predict how a real product or method would perform.';

export const HONESTY_NOTE =
  'This is a simplified educational simulation. Real insect behavior, scent movement, weather, crop conditions, and drone performance are much more complicated. Results here do not predict how any real product or method would perform.';

export const ACTIVITY_STEPS = [
  'Choose a scenario.',
  'Make a prediction.',
  'Design a treatment.',
  'Run the simulation.',
  'Record the result.',
  'Change one variable.',
  'Run it again.',
  'Compare the results.',
  'Ask why the result changed.',
  'Let the optimizer try.',
  'Compare its strategy with yours.',
  'Discuss whether its result would actually make sense in the real world.',
  'Plan a real-world test, then use what it shows to improve the model.'
];
